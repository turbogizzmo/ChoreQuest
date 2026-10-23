"""Regression tests for hot read paths and the vacation-overlap crash.

- The week generator runs on every calendar / dashboard / kiosk / stats read.
  It must stay read-only in the steady state and use a fixed number of
  queries no matter how many chores and kids there are.
- Overlapping family-wide + per-kid vacations must not crash.
- Family streak and the early-bird achievement keep their behaviour after
  being rewritten as set-based queries.
"""

from contextlib import contextmanager
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event, select

from backend.achievements import _check_criteria
from backend.models import (
    AssignmentStatus, ChoreAssignment, Recurrence, RotationCadence, UserRole,
    VacationPeriod,
)
from backend.routers.stats import get_party
from backend.routers.vacation import is_vacation_day
from backend.services.assignment_generator import auto_generate_week_assignments

from tests.unit.conftest import (
    make_category, make_chore, make_rotation, make_rule, make_user,
)

WEEK_START = date(2026, 10, 19)  # a Monday


@contextmanager
def count_statements(db):
    """Collect the first keyword of every SQL statement run on ``db``'s engine."""
    statements: list[str] = []
    engine = db.bind.sync_engine

    def record(conn, cursor, statement, *args):
        statements.append(statement.split()[0].upper())

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


async def _family(db, *, chores: int, kids: int):
    cat = await make_category(db)
    parent = await make_user(db, "perf_parent", role=UserRole.parent)
    kid_users = [await make_user(db, f"perf_kid{i}") for i in range(kids)]
    for n in range(chores):
        chore = await make_chore(db, parent.id, cat.id, title=f"chore {n}")
        for kid in kid_users:
            await make_rule(db, chore.id, kid.id, Recurrence.daily)
    await db.commit()
    return parent, kid_users


# ---------------------------------------------------------------------------
# Week generator: query-count regression
# ---------------------------------------------------------------------------

async def _steady_state_statements(db, *, chores: int, kids: int) -> list[str]:
    await _family(db, chores=chores, kids=kids)
    await auto_generate_week_assignments(db, WEEK_START)  # first call creates the week
    with count_statements(db) as statements:
        await auto_generate_week_assignments(db, WEEK_START)
    return statements


@pytest.mark.asyncio
async def test_week_generation_steady_state_is_read_only(db):
    statements = await _steady_state_statements(db, chores=15, kids=3)

    # Before the rewrite this was 669 statements, 315 of them INSERTs that
    # took SQLite's write lock on every calendar read.
    assert set(statements) == {"SELECT"}, statements
    assert len(statements) <= 8, statements


@pytest.mark.asyncio
async def test_week_generation_query_count_does_not_grow_with_family(db):
    small = await _steady_state_statements(db, chores=2, kids=1)
    await db.execute(ChoreAssignment.__table__.delete())
    await db.commit()

    # Add a much bigger family on top and measure again
    cat = await make_category(db, name="More")
    parent = await make_user(db, "perf_parent_2", role=UserRole.parent)
    kids = [await make_user(db, f"perf_more{i}") for i in range(4)]
    for n in range(20):
        chore = await make_chore(db, parent.id, cat.id, title=f"more {n}")
        for kid in kids:
            await make_rule(db, chore.id, kid.id, Recurrence.daily)
    await db.commit()
    await auto_generate_week_assignments(db, WEEK_START)
    with count_statements(db) as large:
        await auto_generate_week_assignments(db, WEEK_START)

    assert len(large) == len(small)


@pytest.mark.asyncio
async def test_week_generation_creates_only_missing_slots(db):
    _, (kid,) = await _family(db, chores=1, kids=1)
    await auto_generate_week_assignments(db, WEEK_START)
    rows = (await db.execute(select(ChoreAssignment))).scalars().all()
    assert len(rows) == 7

    # Delete one slot; the next read recreates just that one
    await db.delete(rows[3])
    await db.commit()
    with count_statements(db) as statements:
        await auto_generate_week_assignments(db, WEEK_START)
    assert statements.count("INSERT") == 1
    assert len((await db.execute(select(ChoreAssignment))).scalars().all()) == 7


@pytest.mark.asyncio
async def test_stale_rotation_slot_removed_only_while_pending(db):
    cat = await make_category(db)
    parent = await make_user(db, "rot_parent", role=UserRole.parent)
    kid_a = await make_user(db, "rot_a")
    kid_b = await make_user(db, "rot_b")
    chore = await make_chore(db, parent.id, cat.id)
    await make_rule(db, chore.id, kid_a.id, Recurrence.daily)
    await make_rule(db, chore.id, kid_b.id, Recurrence.daily)
    await make_rotation(
        db, chore.id, [kid_a.id, kid_b.id], RotationCadence.weekly,
        current_index=0, last_rotated=datetime.combine(WEEK_START, datetime.min.time()),
    )
    tuesday, wednesday = WEEK_START + timedelta(days=1), WEEK_START + timedelta(days=2)
    db.add(ChoreAssignment(chore_id=chore.id, user_id=kid_b.id, date=tuesday,
                           status=AssignmentStatus.pending))
    db.add(ChoreAssignment(chore_id=chore.id, user_id=kid_b.id, date=wednesday,
                           status=AssignmentStatus.completed))
    await db.commit()

    await auto_generate_week_assignments(db, WEEK_START)

    b_rows = {
        a.date: a.status for a in (await db.execute(
            select(ChoreAssignment).where(ChoreAssignment.user_id == kid_b.id)
        )).scalars()
    }
    assert tuesday not in b_rows                              # wrong-kid pending: removed
    assert b_rows.get(wednesday) == AssignmentStatus.completed  # done work: kept


# ---------------------------------------------------------------------------
# C0 — overlapping vacations
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_overlapping_family_and_kid_vacation_does_not_crash(db):
    _, (kid,) = await _family(db, chores=1, kids=1)
    parent_id = (await make_user(db, "vac_parent", role=UserRole.parent)).id
    span = dict(start_date=WEEK_START, end_date=WEEK_START + timedelta(days=2),
                is_active=True, created_by=parent_id)
    db.add(VacationPeriod(**span))                   # family-wide
    db.add(VacationPeriod(**span, user_id=kid.id))   # same days, this kid
    await db.commit()

    assert await is_vacation_day(db, WEEK_START, user_id=kid.id) is True
    assert await is_vacation_day(db, WEEK_START) is True

    await auto_generate_week_assignments(db, WEEK_START)
    days = {a.date for a in (await db.execute(select(ChoreAssignment))).scalars()}
    assert days == {WEEK_START + timedelta(days=i) for i in range(3, 7)}


@pytest.mark.asyncio
async def test_kid_vacation_only_skips_that_kid(db):
    parent, (kid_a, kid_b) = await _family(db, chores=1, kids=2)
    db.add(VacationPeriod(start_date=WEEK_START, end_date=WEEK_START + timedelta(days=6),
                          is_active=True, created_by=parent.id, user_id=kid_a.id))
    await db.commit()

    await auto_generate_week_assignments(db, WEEK_START)
    users = [a.user_id for a in (await db.execute(select(ChoreAssignment))).scalars()]
    assert users.count(kid_a.id) == 0
    assert users.count(kid_b.id) == 7


# ---------------------------------------------------------------------------
# Family streak (one grouped query)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_family_streak_counts_days_where_every_kid_completed(db):
    cat = await make_category(db)
    parent = await make_user(db, "streak_parent", role=UserRole.parent)
    kid_a = await make_user(db, "streak_a")
    kid_b = await make_user(db, "streak_b")
    chores = [await make_chore(db, parent.id, cat.id, title=f"s{i}") for i in range(2)]
    today = date.today()

    def done(kid, day, chore, status=AssignmentStatus.verified):
        db.add(ChoreAssignment(chore_id=chore.id, user_id=kid.id, date=day, status=status))

    for back in (0, 1):                       # both kids today and yesterday
        done(kid_a, today - timedelta(days=back), chores[0])
        done(kid_b, today - timedelta(days=back), chores[0])
    done(kid_a, today, chores[1], AssignmentStatus.completed)  # extra row, same kid/day
    done(kid_a, today - timedelta(days=2), chores[0])          # only one kid 2 days ago
    await db.commit()

    result = await get_party(current_user=parent, db=db)
    assert result["family_streak"] == 2


# ---------------------------------------------------------------------------
# Early-bird achievement (streamed column scan)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_completion_before_time_finds_an_early_completion(db, monkeypatch):
    from zoneinfo import ZoneInfo
    monkeypatch.setattr("backend.achievements._LOCAL_TZ", ZoneInfo("UTC"))
    cat = await make_category(db)
    parent = await make_user(db, "early_parent", role=UserRole.parent)
    kid = await make_user(db, "early_kid")
    chore = await make_chore(db, parent.id, cat.id)
    for day, hour in ((1, 15), (2, 18)):
        db.add(ChoreAssignment(
            chore_id=chore.id, user_id=kid.id, date=date(2026, 1, day),
            status=AssignmentStatus.verified, completed_at=datetime(2026, 1, day, hour),
        ))
    await db.commit()

    criteria = {"type": "completion_before_time", "hour": 9}
    assert await _check_criteria(db, kid, criteria) is False

    db.add(ChoreAssignment(
        chore_id=chore.id, user_id=kid.id, date=date(2026, 1, 3),
        status=AssignmentStatus.completed, completed_at=datetime(2026, 1, 3, 7, 30),
    ))
    await db.commit()
    assert await _check_criteria(db, kid, criteria) is True
