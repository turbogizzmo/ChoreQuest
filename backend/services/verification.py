"""Shared assignment-verification logic.

Used by the parent approve endpoints in ``routers/chores.py`` and by the
auto-approve background job, so every path awards XP, event bonuses, pet XP,
streaks and notifications identically.
"""

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.achievements import check_achievements
from backend.models import (
    AppSetting,
    AssignmentStatus,
    ChoreAssignment,
    ChoreAssignmentRule,
    Notification,
    NotificationType,
    PointTransaction,
    PointType,
    Recurrence,
    SeasonalEvent,
    User,
    UserRole,
)
from backend.services.balance import credit_points
from backend.services.pet_leveling import award_pet_xp_db
from backend.services.streak import update_streak
from backend.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

AUTO_APPROVE_SETTING = "auto_approve_hours"
AUTO_APPROVE_MAX_HOURS = 24 * 30


async def award_verified_assignment(
    db: AsyncSession,
    assignment: ChoreAssignment,
    *,
    verified_by: int | None,
    now: datetime,
    today: date,
    auto: bool = False,
) -> tuple[User, int]:
    """Mark ``assignment`` verified and award everything that goes with it.

    ``assignment.chore`` must be loaded. ``verified_by`` is None for
    auto-approval. Mutates the session but does not commit — call
    :func:`finish_verification` afterwards.
    Returns ``(kid, total_xp_awarded)``.
    """
    chore = assignment.chore
    # Multi-completion chores earn XP per completion
    base_points = chore.points * max(1, assignment.completion_count or 1)

    assignment.status = AssignmentStatus.verified
    assignment.verified_at = now
    assignment.verified_by = verified_by
    assignment.updated_at = now

    # Event multiplier (naive UTC to match SQLite storage)
    now_naive = now.replace(tzinfo=None)
    ev_result = await db.execute(
        select(SeasonalEvent).where(
            SeasonalEvent.is_active == True,
            SeasonalEvent.start_date <= now_naive,
            SeasonalEvent.end_date >= now_naive,
        )
    )
    active_events = ev_result.scalars().all()
    multiplier = 1.0
    for event in active_events:
        multiplier *= event.multiplier

    db.add(PointTransaction(
        user_id=assignment.user_id,
        amount=base_points,
        type=PointType.chore_complete,
        description=f"Completed: {chore.title}" + (" (auto-approved)" if auto else ""),
        reference_id=assignment.id,
    ))
    total_awarded = base_points

    if multiplier > 1.0:
        bonus_points = int(base_points * multiplier) - base_points
        if bonus_points > 0:
            event_names = ", ".join(e.title for e in active_events)
            db.add(PointTransaction(
                user_id=assignment.user_id,
                amount=bonus_points,
                type=PointType.event_multiplier,
                description=f"Event bonus ({event_names}): {chore.title}",
                reference_id=assignment.id,
            ))
            total_awarded += bonus_points

    kid = (await db.execute(select(User).where(User.id == assignment.user_id))).scalar_one()
    await credit_points(db, kid, total_awarded)

    pet_levelup = await award_pet_xp_db(db, kid, total_awarded)
    if pet_levelup:
        db.add(Notification(
            user_id=kid.id,
            type=NotificationType.pet_levelup,
            title="Pet Leveled Up!",
            message=f"Your pet reached level {pet_levelup['new_level']} — {pet_levelup['name']}!",
            reference_type="pet",
        ))

    await update_streak(db, kid, today)

    # One-time quests no longer appear as assigned once verified
    if chore.recurrence == Recurrence.once:
        rule = (await db.execute(
            select(ChoreAssignmentRule).where(
                ChoreAssignmentRule.chore_id == chore.id,
                ChoreAssignmentRule.user_id == assignment.user_id,
                ChoreAssignmentRule.is_active == True,
            )
        )).scalar_one_or_none()
        if rule:
            rule.is_active = False

    db.add(Notification(
        user_id=assignment.user_id,
        type=NotificationType.chore_verified,
        title="Quest Approved!",
        message=(
            f"'{chore.title}' was auto-approved! You earned {total_awarded} XP!"
            if auto else
            f"'{chore.title}' was approved! You earned {total_awarded} XP!"
        ),
        reference_type="chore_assignment",
        reference_id=assignment.id,
    ))

    return kid, total_awarded


async def finish_verification(
    db: AsyncSession,
    assignment: ChoreAssignment,
    kid: User,
    total_awarded: int,
) -> dict | None:
    """Commit, then run achievements, the avatar-drop roll and the kid's WS push.

    Returns the avatar drop (if any).
    """
    await db.commit()
    await check_achievements(db, kid)

    from backend.routers.avatar import try_quest_drop  # avoid circular import
    drop = await try_quest_drop(db, kid, assignment.chore.difficulty.value)
    if drop:
        await db.commit()

    ws_data = {
        "chore_id": assignment.chore.id,
        "chore_title": assignment.chore.title,
        "points": total_awarded,
        "assignment_id": assignment.id,
    }
    if drop:
        ws_data["avatar_drop"] = drop
    await ws_manager.send_to_user(
        assignment.user_id,
        {"type": "chore_verified", "data": ws_data},
    )
    return drop


# ---------------------------------------------------------------------------
# Auto-approve
# ---------------------------------------------------------------------------

def parse_auto_approve_hours(raw: str | None) -> int:
    """Parse the setting; anything invalid or <= 0 means disabled (0)."""
    try:
        hours = int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        return 0
    return max(0, min(hours, AUTO_APPROVE_MAX_HOURS))


async def get_auto_approve_hours(db: AsyncSession) -> int:
    setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == AUTO_APPROVE_SETTING)
    )).scalar_one_or_none()
    return parse_auto_approve_hours(setting.value if setting else None)


async def auto_approve_stale_completions(
    db: AsyncSession,
    now: datetime | None = None,
) -> int:
    """Approve completed assignments that have waited longer than the
    configured ``auto_approve_hours``. Returns how many were approved.

    ``completed_at`` is a stored UTC timestamp, so the cutoff is computed in
    UTC (comparing timestamp to timestamp — not a calendar-day boundary).
    """
    hours = await get_auto_approve_hours(db)
    if hours <= 0:
        return 0

    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=hours)).replace(tzinfo=None)

    ids = (await db.execute(
        select(ChoreAssignment.id).where(
            ChoreAssignment.status == AssignmentStatus.completed,
            ChoreAssignment.completed_at.is_not(None),
            ChoreAssignment.completed_at <= cutoff,
        )
    )).scalars().all()
    if not ids:
        return 0

    parent_ids = (await db.execute(
        select(User.id).where(
            User.role.in_([UserRole.parent, UserRole.admin]),
            User.is_active == True,
        )
    )).scalars().all()

    approved = 0
    for assignment_id in ids:
        try:
            # Atomically claim the row so a parent approving/rejecting at the
            # same moment can't cause a double award.
            claim = await db.execute(
                update(ChoreAssignment)
                .where(
                    ChoreAssignment.id == assignment_id,
                    ChoreAssignment.status == AssignmentStatus.completed,
                )
                .values(status=AssignmentStatus.verified)
            )
            if claim.rowcount != 1:
                await db.rollback()
                continue

            assignment = (await db.execute(
                select(ChoreAssignment)
                .where(ChoreAssignment.id == assignment_id)
                .options(selectinload(ChoreAssignment.chore))
                .execution_options(populate_existing=True)
            )).scalar_one()

            kid, total = await award_verified_assignment(
                db, assignment,
                verified_by=None, now=now, today=date.today(), auto=True,
            )
            for pid in parent_ids:
                db.add(Notification(
                    user_id=pid,
                    type=NotificationType.chore_verified,
                    title="Quest Auto-Approved",
                    message=(
                        f"{kid.display_name}'s '{assignment.chore.title}' was auto-approved "
                        f"after {hours}h without review (+{total} XP)."
                    ),
                    reference_type="chore_assignment",
                    reference_id=assignment.id,
                ))
            await finish_verification(db, assignment, kid, total)
            approved += 1
        except Exception:
            logger.exception("Auto-approve failed for assignment %s", assignment_id)
            await db.rollback()

    if approved:
        logger.info("Auto-approved %d assignment(s) older than %dh", approved, hours)
        await ws_manager.broadcast({"type": "data_changed", "data": {"entity": "chore"}})
    return approved
