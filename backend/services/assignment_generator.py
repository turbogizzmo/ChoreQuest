"""Centralised assignment generation logic.

Used by both the calendar auto-generation endpoint and the daily reset
background task to avoid duplicating the complex scheduling rules.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import (
    Chore,
    ChoreAssignment,
    ChoreAssignmentRule,
    ChoreExclusion,
    ChoreRotation,
    AssignmentStatus,
    Recurrence,
    VacationPeriod,
)
from backend.services.recurrence import should_create_on_day
from backend.services.rotation import (
    get_rotation_kid_for_day,
    should_advance_rotation,
    advance_rotation,
    advance_rotation_and_mirror,
)

logger = logging.getLogger(__name__)


async def auto_generate_week_assignments(
    db: AsyncSession, week_start: date
) -> None:
    """Generate ChoreAssignment records for recurring chores across a week.

    Slots recorded in ``chore_exclusions`` are skipped so that
    intentionally removed assignments are not recreated.

    This function does NOT advance rotations -- it reads the current
    rotation state and projects forward (useful for calendar views).

    It runs on every calendar / dashboard / kiosk read, so everything is
    loaded up front in a handful of queries and only genuinely missing
    slots are written. In the steady state (week already generated) it
    issues no writes at all and never takes SQLite's write lock.
    """
    week_end = week_start + timedelta(days=6)
    plan = await _load_week_plan(db, week_start, week_end)

    # Filter out family-wide vacation days from week generation
    week_dates = [
        d for d in (week_start + timedelta(days=i) for i in range(7))
        if not plan.on_vacation(d)
    ]

    exclusion_set = await _load_exclusion_set(db, week_start, week_end)
    chores = await _load_active_chores(db)
    chore_ids = [c.id for c in chores]

    rules_by_chore: dict[int, list[ChoreAssignmentRule]] = defaultdict(list)
    rotations: dict[int, ChoreRotation] = {}
    if chore_ids:
        for rule in (await db.execute(
            select(ChoreAssignmentRule).where(
                ChoreAssignmentRule.chore_id.in_(chore_ids),
                ChoreAssignmentRule.is_active == True,
            )
        )).scalars():
            rules_by_chore[rule.chore_id].append(rule)
        rotations = {
            r.chore_id: r for r in (await db.execute(
                select(ChoreRotation).where(ChoreRotation.chore_id.in_(chore_ids))
            )).scalars()
        }

    legacy_chores = []
    for chore in chores:
        rules = rules_by_chore.get(chore.id)
        if rules:
            _plan_from_rules(
                plan, chore, rules, rotations.get(chore.id), week_dates, exclusion_set,
            )
        else:
            legacy_chores.append(chore)

    if legacy_chores:
        fallback_ids = await _load_legacy_user_ids(
            db, [c.id for c in legacy_chores if not (
                rotations.get(c.id) and rotations[c.id].kid_ids
            )],
        )
        for chore in legacy_chores:
            rotation = rotations.get(chore.id)
            user_ids = (
                [int(k) for k in rotation.kid_ids] if rotation and rotation.kid_ids
                else fallback_ids.get(chore.id, [])
            )
            _plan_legacy(plan, chore, user_ids, week_dates, exclusion_set)

    if not plan.to_create and not plan.to_remove:
        return  # steady state: read-only

    if plan.to_create:
        await db.execute(
            sqlite_insert(ChoreAssignment).on_conflict_do_nothing(
                index_elements=["chore_id", "user_id", "date"]
            ),
            [
                {"chore_id": c, "user_id": u, "date": d, "status": AssignmentStatus.pending}
                for c, u, d in sorted(plan.to_create)
            ],
        )
        logger.debug("Created %d week assignment(s)", len(plan.to_create))
    for chore_id, user_id, day in plan.to_remove:
        # Only pending rows are removed — completed/verified are never touched
        await db.execute(
            delete(ChoreAssignment).where(
                ChoreAssignment.chore_id == chore_id,
                ChoreAssignment.user_id == user_id,
                ChoreAssignment.date == day,
                ChoreAssignment.status == AssignmentStatus.pending,
            )
        )
        logger.debug(
            "Removed stale rotation assignment: chore=%d user=%d day=%s",
            chore_id, user_id, day,
        )
    await db.commit()


async def expire_stale_assignments(db: AsyncSession, today: date) -> None:
    """Mark pending assignments older than the grace window as skipped.

    Prevents accumulated past-due assignments from being completable and
    keeps the kid dashboard free of irrelevant old quests.
    """
    from backend.models import AppSetting
    grace_result = await db.execute(
        select(AppSetting).where(AppSetting.key == "grace_period_days")
    )
    grace_setting = grace_result.scalar_one_or_none()
    grace_days = int(grace_setting.value) if grace_setting else 1
    cutoff = today - timedelta(days=grace_days)

    await db.execute(
        update(ChoreAssignment)
        .where(
            ChoreAssignment.date < cutoff,
            ChoreAssignment.status == AssignmentStatus.pending,
        )
        .values(status=AssignmentStatus.skipped)
    )
    logger.info("Expired stale pending assignments older than %s", cutoff)


async def generate_daily_assignments(db: AsyncSession, today: date) -> None:
    """Generate assignments for today with rotation advancement.

    Called by the daily reset background task. Unlike the week-based
    generator, this function advances rotations when their cadence
    period has elapsed.  Rotation is only advanced on days when the
    chore actually has an occurrence so that non-active days (e.g.
    weekends for a Mon-Fri custom schedule) don't waste rotation slots.
    """
    # Check vacation mode — skip generation if today is a vacation day
    from backend.routers.vacation import is_vacation_day
    if await is_vacation_day(db, today):
        logger.info("Skipping assignment generation — vacation day %s", today)
        return

    # Two separate now values:
    #   now_local — naive local time used by should_advance_rotation for .date() day-boundary checks
    #   now_utc   — tz-aware UTC stored in rotation.last_rotated, consistent with all other writers
    #               (rotations.py:57, chores.py:547,555 all use datetime.now(timezone.utc))
    now_local = datetime.now()
    now_utc = datetime.now(timezone.utc)
    chores = await _load_active_chores(db)

    for chore in chores:
        rules = await _load_active_rules(db, chore.id)

        if rules:
            rotation = await _load_rotation(db, chore.id)

            # Pre-compute which rules fire today so we know whether
            # the chore has an occurrence before advancing rotation.
            created_wd = chore.created_at.weekday()
            created_dt = (
                chore.created_at.date()
                if hasattr(chore.created_at, "date")
                else chore.created_at
            )
            active_rules = [
                r for r in rules
                if r.recurrence != Recurrence.once
                and should_create_on_day(
                    r.recurrence, today, created_wd, r.custom_days,
                    created_at_date=created_dt,
                )
            ]

            # Only advance rotation on days the chore actually runs
            if rotation and active_rules and should_advance_rotation(rotation, now_local):
                await advance_rotation_and_mirror(rotation, db, now_utc)

            for rule in active_rules:
                # Rotation filtering: only generate for the current rotation kid
                if rotation and int(rule.user_id) != int(
                    rotation.kid_ids[rotation.current_index]
                ):
                    continue

                # Skip if this kid is individually on vacation today
                if await is_vacation_day(db, today, user_id=int(rule.user_id)):
                    logger.debug(
                        "Skipping assignment for kid %d — personal vacation %s",
                        rule.user_id, today,
                    )
                    continue

                await _create_if_missing(db, chore.id, rule.user_id, today)
        else:
            # Legacy: chore-level recurrence
            if chore.recurrence == Recurrence.once:
                continue

            if not should_create_on_day(
                chore.recurrence, today, chore.created_at.weekday(), chore.custom_days,
                created_at_date=chore.created_at.date() if hasattr(chore.created_at, 'date') else chore.created_at,
            ):
                continue

            rotation = await _load_rotation(db, chore.id)
            if rotation:
                if should_advance_rotation(rotation, now_local):
                    await advance_rotation_and_mirror(rotation, db, now_utc)
                user_ids = [rotation.kid_ids[rotation.current_index]]
            else:
                user_ids = await _get_legacy_user_ids(db, chore.id)

            for uid in user_ids:
                # Skip if this kid is individually on vacation today
                if await is_vacation_day(db, today, user_id=int(uid)):
                    logger.debug(
                        "Skipping assignment for kid %d — personal vacation %s",
                        uid, today,
                    )
                    continue
                await _create_if_missing(db, chore.id, uid, today)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _load_active_chores(db: AsyncSession) -> list[Chore]:
    result = await db.execute(select(Chore).where(Chore.is_active == True))
    return list(result.scalars().all())


async def _load_active_rules(
    db: AsyncSession, chore_id: int
) -> list[ChoreAssignmentRule]:
    result = await db.execute(
        select(ChoreAssignmentRule).where(
            ChoreAssignmentRule.chore_id == chore_id,
            ChoreAssignmentRule.is_active == True,
        )
    )
    return list(result.scalars().all())


async def _load_rotation(
    db: AsyncSession, chore_id: int
) -> ChoreRotation | None:
    result = await db.execute(
        select(ChoreRotation).where(ChoreRotation.chore_id == chore_id)
    )
    return result.scalar_one_or_none()


async def _load_exclusion_set(
    db: AsyncSession, start: date, end: date
) -> set[tuple[int, int, date]]:
    result = await db.execute(
        select(ChoreExclusion).where(
            ChoreExclusion.date >= start,
            ChoreExclusion.date <= end,
        )
    )
    return {
        (e.chore_id, e.user_id, e.date) for e in result.scalars().all()
    }


async def _get_legacy_user_ids(db: AsyncSession, chore_id: int) -> list[int]:
    """Fall back to distinct user IDs from past assignments."""
    result = await db.execute(
        select(ChoreAssignment.user_id)
        .where(ChoreAssignment.chore_id == chore_id)
        .distinct()
    )
    return list(result.scalars().all())


@dataclass
class _WeekPlan:
    """Everything the week projection needs, preloaded, plus the planned writes."""
    vacations: list[tuple[int | None, date, date]]
    existing: dict[tuple[int, int, date], AssignmentStatus]
    to_create: set[tuple[int, int, date]] = field(default_factory=set)
    to_remove: set[tuple[int, int, date]] = field(default_factory=set)

    def on_vacation(self, day: date, user_id: int | None = None) -> bool:
        """Same semantics as ``is_vacation_day``: family-wide always counts,
        a per-kid period only counts for that kid."""
        return any(
            start <= day <= end and (vac_user is None or vac_user == user_id)
            for vac_user, start, end in self.vacations
        )

    def create(self, chore_id: int, user_id: int, day: date) -> None:
        key = (chore_id, int(user_id), day)
        if key not in self.existing:
            self.to_create.add(key)

    def remove_stale(self, chore_id: int, user_id: int, day: date) -> None:
        key = (chore_id, int(user_id), day)
        if self.existing.get(key) == AssignmentStatus.pending:
            self.to_remove.add(key)


async def _load_week_plan(db: AsyncSession, start: date, end: date) -> _WeekPlan:
    vacations = (await db.execute(
        select(VacationPeriod.user_id, VacationPeriod.start_date, VacationPeriod.end_date)
        .where(
            VacationPeriod.is_active == True,
            VacationPeriod.start_date <= end,
            VacationPeriod.end_date >= start,
        )
    )).all()
    existing = (await db.execute(
        select(
            ChoreAssignment.chore_id, ChoreAssignment.user_id,
            ChoreAssignment.date, ChoreAssignment.status,
        ).where(ChoreAssignment.date >= start, ChoreAssignment.date <= end)
    )).all()
    return _WeekPlan(
        vacations=[(v.user_id, v.start_date, v.end_date) for v in vacations],
        existing={(r.chore_id, r.user_id, r.date): r.status for r in existing},
    )


async def _load_legacy_user_ids(
    db: AsyncSession, chore_ids: list[int],
) -> dict[int, list[int]]:
    """Batched ``_get_legacy_user_ids``: distinct past assignees per chore."""
    if not chore_ids:
        return {}
    rows = (await db.execute(
        select(ChoreAssignment.chore_id, ChoreAssignment.user_id)
        .where(ChoreAssignment.chore_id.in_(chore_ids))
        .distinct()
    )).all()
    by_chore: dict[int, list[int]] = defaultdict(list)
    for chore_id, user_id in rows:
        by_chore[chore_id].append(user_id)
    return by_chore


async def _create_if_missing(
    db: AsyncSession, chore_id: int, user_id: int, day: date
) -> bool:
    """Create a pending assignment if one doesn't already exist.

    Returns True if a new assignment was created.
    """
    stmt = sqlite_insert(ChoreAssignment).values(
        chore_id=chore_id,
        user_id=user_id,
        date=day,
        status=AssignmentStatus.pending,
    ).on_conflict_do_nothing(
        index_elements=["chore_id", "user_id", "date"]
    )
    result = await db.execute(stmt)
    created = result.rowcount == 1
    if created:
        logger.debug("Created assignment: chore=%d user=%d day=%s", chore_id, user_id, day)
    return created


def _plan_from_rules(
    plan: _WeekPlan,
    chore: Chore,
    rules: list[ChoreAssignmentRule],
    rotation: ChoreRotation | None,
    week_dates: list[date],
    exclusion_set: set[tuple[int, int, date]],
) -> None:
    """Plan week assignments using per-kid assignment rules (no I/O)."""
    active_weekdays = _collect_active_weekdays(rules, chore) if rotation else None

    # Anchor the projection to when current_index was last set, NOT today.
    # This keeps the calendar consistent regardless of whether the daily
    # reset task has advanced the rotation yet (e.g. after container restart).
    if rotation and rotation.last_rotated:
        lr = rotation.last_rotated
        reference_day = lr.date() if hasattr(lr, "date") else lr
    else:
        reference_day = date.today()

    for rule in rules:
        if rule.recurrence == Recurrence.once:
            continue

        for day in week_dates:
            if not should_create_on_day(
                rule.recurrence, day, chore.created_at.weekday(), rule.custom_days,
                created_at_date=chore.created_at.date() if hasattr(chore.created_at, 'date') else chore.created_at,
            ):
                continue

            # Rotation filtering
            if rotation and rotation.kid_ids:
                expected_kid = get_rotation_kid_for_day(
                    rotation, day, reference_day, active_weekdays,
                )
                if int(rule.user_id) != expected_kid:
                    # Clean up any stale pending assignment for the wrong kid
                    # on this day (could have been created by a prior buggy run).
                    plan.remove_stale(chore.id, rule.user_id, day)
                    continue

            if (chore.id, rule.user_id, day) in exclusion_set:
                continue

            # Skip if this kid is on a personal vacation for this specific day
            if plan.on_vacation(day, int(rule.user_id)):
                continue

            plan.create(chore.id, rule.user_id, day)


def _collect_active_weekdays(
    rules: list[ChoreAssignmentRule], chore: Chore,
) -> list[int] | None:
    """Determine the set of weekdays on which a chore has occurrences.

    Returns ``None`` when the chore runs every day (no filtering needed).
    """
    weekdays: set[int] = set()
    for rule in rules:
        if rule.recurrence in (Recurrence.once,):
            continue
        if rule.recurrence == Recurrence.daily:
            return None  # Runs every day — calendar-day counting is fine
        if rule.recurrence == Recurrence.custom and rule.custom_days:
            weekdays.update(rule.custom_days)
        elif rule.recurrence in (Recurrence.weekly, Recurrence.fortnightly):
            weekdays.add(chore.created_at.weekday())
    return sorted(weekdays) if weekdays else None


def _plan_legacy(
    plan: _WeekPlan,
    chore: Chore,
    user_ids: list[int],
    week_dates: list[date],
    exclusion_set: set[tuple[int, int, date]],
) -> None:
    """Plan week assignments using chore-level recurrence (legacy path).

    ``user_ids`` are the rotation's kids, or the chore's past assignees.
    """
    if chore.recurrence == Recurrence.once or not user_ids:
        return

    for day in week_dates:
        if not should_create_on_day(
            chore.recurrence, day, chore.created_at.weekday(), chore.custom_days,
            created_at_date=chore.created_at.date() if hasattr(chore.created_at, 'date') else chore.created_at,
        ):
            continue

        for user_id in user_ids:
            if (chore.id, user_id, day) in exclusion_set:
                continue
            if plan.on_vacation(day, int(user_id)):
                continue
            plan.create(chore.id, user_id, day)
