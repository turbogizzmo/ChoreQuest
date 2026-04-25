"""Unit tests for backend/services/stats_helpers.py.

Covers:
- count_assignments: total and completed-only counts
- completion_rate: percentage calculation, zero-total guard
"""

from datetime import date

import pytest

from backend.models import ChoreAssignment, AssignmentStatus
from backend.services.stats_helpers import completion_rate, count_assignments

from tests.unit.conftest import make_category, make_chore, make_user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _add_assignment(
    db,
    chore_id: int,
    user_id: int,
    assignment_date: date,
    status: AssignmentStatus = AssignmentStatus.pending,
) -> ChoreAssignment:
    a = ChoreAssignment(
        chore_id=chore_id,
        user_id=user_id,
        date=assignment_date,
        status=status,
    )
    db.add(a)
    await db.flush()
    return a


# ---------------------------------------------------------------------------
# count_assignments
# ---------------------------------------------------------------------------

class TestCountAssignments:
    @pytest.mark.asyncio
    async def test_returns_zero_with_no_assignments(self, db):
        parent = await make_user(db, "stats_parent1", role="parent")  # type: ignore[arg-type]
        kid = await make_user(db, "stats_kid1")
        await db.commit()
        count = await count_assignments(db, kid.id, since=date(2024, 1, 1))
        assert count == 0

    @pytest.mark.asyncio
    async def test_counts_all_assignments(self, db):
        cat = await make_category(db)
        parent = await make_user(db, "stats_parent2", role="parent")  # type: ignore[arg-type]
        kid = await make_user(db, "stats_kid2")
        chore = await make_chore(db, parent.id, cat.id)
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 8))
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 9), AssignmentStatus.completed)
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 10), AssignmentStatus.verified)
        await db.commit()

        count = await count_assignments(db, kid.id, since=date(2024, 4, 1))
        assert count == 3

    @pytest.mark.asyncio
    async def test_completed_only_filter(self, db):
        cat = await make_category(db)
        parent = await make_user(db, "stats_parent3", role="parent")  # type: ignore[arg-type]
        kid = await make_user(db, "stats_kid3")
        chore = await make_chore(db, parent.id, cat.id)
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 8))  # pending
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 9), AssignmentStatus.completed)
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 10), AssignmentStatus.verified)
        await db.commit()

        count = await count_assignments(db, kid.id, since=date(2024, 4, 1), completed_only=True)
        assert count == 2

    @pytest.mark.asyncio
    async def test_since_filter_excludes_older_assignments(self, db):
        cat = await make_category(db)
        parent = await make_user(db, "stats_parent4", role="parent")  # type: ignore[arg-type]
        kid = await make_user(db, "stats_kid4")
        chore = await make_chore(db, parent.id, cat.id)
        await _add_assignment(db, chore.id, kid.id, date(2024, 3, 31))  # before window
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 1), AssignmentStatus.completed)
        await db.commit()

        count = await count_assignments(db, kid.id, since=date(2024, 4, 1))
        assert count == 1

    @pytest.mark.asyncio
    async def test_counts_only_for_specified_user(self, db):
        cat = await make_category(db)
        parent = await make_user(db, "stats_parent5", role="parent")  # type: ignore[arg-type]
        kid_a = await make_user(db, "stats_kid5a")
        kid_b = await make_user(db, "stats_kid5b")
        chore = await make_chore(db, parent.id, cat.id)
        await _add_assignment(db, chore.id, kid_a.id, date(2024, 4, 8))
        await _add_assignment(db, chore.id, kid_b.id, date(2024, 4, 8))
        await db.commit()

        assert await count_assignments(db, kid_a.id, since=date(2024, 4, 1)) == 1
        assert await count_assignments(db, kid_b.id, since=date(2024, 4, 1)) == 1


# ---------------------------------------------------------------------------
# completion_rate
# ---------------------------------------------------------------------------

class TestCompletionRate:
    @pytest.mark.asyncio
    async def test_zero_total_returns_zero_percent(self, db):
        parent = await make_user(db, "rate_parent1", role="parent")  # type: ignore[arg-type]
        kid = await make_user(db, "rate_kid1")
        await db.commit()
        total, completed, rate = await completion_rate(db, kid.id, since=date(2024, 4, 1))
        assert total == 0
        assert completed == 0
        assert rate == 0.0

    @pytest.mark.asyncio
    async def test_100_percent_completion(self, db):
        cat = await make_category(db)
        parent = await make_user(db, "rate_parent2", role="parent")  # type: ignore[arg-type]
        kid = await make_user(db, "rate_kid2")
        chore = await make_chore(db, parent.id, cat.id)
        for i in range(5):
            await _add_assignment(
                db, chore.id, kid.id, date(2024, 4, i + 1), AssignmentStatus.verified
            )
        await db.commit()
        total, completed, rate = await completion_rate(db, kid.id, since=date(2024, 4, 1))
        assert total == 5
        assert completed == 5
        assert rate == 100.0

    @pytest.mark.asyncio
    async def test_partial_completion_rate(self, db):
        cat = await make_category(db)
        parent = await make_user(db, "rate_parent3", role="parent")  # type: ignore[arg-type]
        kid = await make_user(db, "rate_kid3")
        chore = await make_chore(db, parent.id, cat.id)
        # 3 completed, 1 pending → 75%
        for i in range(3):
            await _add_assignment(
                db, chore.id, kid.id, date(2024, 4, i + 1), AssignmentStatus.completed
            )
        await _add_assignment(db, chore.id, kid.id, date(2024, 4, 4))  # pending
        await db.commit()

        total, completed, rate = await completion_rate(db, kid.id, since=date(2024, 4, 1))
        assert total == 4
        assert completed == 3
        assert rate == 75.0
