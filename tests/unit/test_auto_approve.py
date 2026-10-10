"""Unit tests for auto-approving quests parents haven't reviewed in time."""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from backend.models import (
    AppSetting,
    AssignmentStatus,
    ChoreAssignment,
    Notification,
    PointTransaction,
    User,
    UserRole,
)
from backend.services.verification import (
    auto_approve_stale_completions,
    parse_auto_approve_hours,
)

from tests.unit.conftest import make_category, make_chore, make_user

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


async def _setup(db, *, hours: str | None = "48", completed_hours_ago: float = 49,
                 status=AssignmentStatus.completed, completion_count: int = 1):
    if hours is not None:
        db.add(AppSetting(key="auto_approve_hours", value=hours))
    cat = await make_category(db)
    parent = await make_user(db, "parent_aa", role=UserRole.parent)
    kid = await make_user(db, "kid_aa")
    chore = await make_chore(db, parent.id, cat.id)  # 10 points
    completed_at = (NOW - timedelta(hours=completed_hours_ago)).replace(tzinfo=None)
    assignment = ChoreAssignment(
        chore_id=chore.id,
        user_id=kid.id,
        date=completed_at.date(),
        status=status,
        completed_at=completed_at,
        completion_count=completion_count,
    )
    db.add(assignment)
    await db.commit()
    return parent, kid, assignment


async def _reload(db, model, pk):
    return (await db.execute(
        select(model).where(model.id == pk).execution_options(populate_existing=True)
    )).scalar_one()


@pytest.mark.parametrize("raw,expected", [
    (None, 0), ("", 0), ("abc", 0), ("-5", 0), ("0", 0), ("48", 48), ("99999", 720),
])
def test_parse_auto_approve_hours(raw, expected):
    assert parse_auto_approve_hours(raw) == expected


@pytest.mark.asyncio
async def test_disabled_by_default(db):
    _, kid, assignment = await _setup(db, hours=None)
    assert await auto_approve_stale_completions(db, now=NOW) == 0
    assert (await _reload(db, ChoreAssignment, assignment.id)).status == AssignmentStatus.completed


@pytest.mark.asyncio
async def test_approves_after_window(db):
    parent, kid, assignment = await _setup(db, completed_hours_ago=49)

    assert await auto_approve_stale_completions(db, now=NOW) == 1

    a = await _reload(db, ChoreAssignment, assignment.id)
    assert a.status == AssignmentStatus.verified
    assert a.verified_by is None  # None marks an automatic approval
    assert a.verified_at is not None

    k = await _reload(db, User, kid.id)
    assert k.points_balance == 10
    assert k.total_points_earned == 10
    assert k.last_streak_date == date.today()

    txns = (await db.execute(
        select(PointTransaction).where(PointTransaction.reference_id == assignment.id)
    )).scalars().all()
    assert [t.amount for t in txns] == [10]
    assert "auto-approved" in txns[0].description

    notified = {n.user_id for n in (await db.execute(select(Notification))).scalars().all()}
    assert {kid.id, parent.id} <= notified


@pytest.mark.asyncio
async def test_leaves_recent_completions_alone(db):
    _, kid, assignment = await _setup(db, completed_hours_ago=47)
    assert await auto_approve_stale_completions(db, now=NOW) == 0
    assert (await _reload(db, ChoreAssignment, assignment.id)).status == AssignmentStatus.completed
    assert (await _reload(db, User, kid.id)).points_balance == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [AssignmentStatus.verified, AssignmentStatus.pending])
async def test_ignores_non_completed(db, status):
    _, kid, _ = await _setup(db, status=status)
    assert await auto_approve_stale_completions(db, now=NOW) == 0
    assert (await _reload(db, User, kid.id)).points_balance == 0


@pytest.mark.asyncio
async def test_multi_completion_awards_per_completion(db):
    _, kid, _ = await _setup(db, completion_count=3)
    assert await auto_approve_stale_completions(db, now=NOW) == 1
    assert (await _reload(db, User, kid.id)).points_balance == 30


@pytest.mark.asyncio
async def test_second_run_does_not_double_award(db):
    _, kid, _ = await _setup(db)
    assert await auto_approve_stale_completions(db, now=NOW) == 1
    assert await auto_approve_stale_completions(db, now=NOW) == 0
    assert (await _reload(db, User, kid.id)).points_balance == 10
