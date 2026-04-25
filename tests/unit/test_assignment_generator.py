"""Unit tests for backend/services/assignment_generator.py.

Covers:
- auto_generate_week_assignments creates the expected assignments
- Running the generator twice (idempotent) does NOT create duplicate rows
- Rotation filtering: only the current kid's rule produces an assignment
- Exclusions are respected (excluded slots are not recreated)
"""

from datetime import date, datetime

import pytest

from sqlalchemy import select

from backend.models import ChoreAssignment, RotationCadence, Recurrence
from backend.services.assignment_generator import auto_generate_week_assignments

from tests.unit.conftest import (
    make_category,
    make_chore,
    make_rotation,
    make_rule,
    make_user,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _count_assignments(db, chore_id: int) -> int:
    result = await db.execute(
        select(ChoreAssignment).where(ChoreAssignment.chore_id == chore_id)
    )
    return len(result.scalars().all())


# ---------------------------------------------------------------------------
# Basic generation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generates_daily_assignments_for_week(db):
    """A daily chore with one rule should produce 7 assignments for a full week."""
    cat = await make_category(db)
    parent = await make_user(db, "parent1", role="parent")  # type: ignore[arg-type]
    kid = await make_user(db, "kid1")

    chore = await make_chore(db, parent.id, cat.id, recurrence=Recurrence.daily)
    await make_rule(db, chore.id, kid.id, Recurrence.daily)
    await db.commit()

    week_start = date(2024, 4, 8)  # Monday
    await auto_generate_week_assignments(db, week_start)

    count = await _count_assignments(db, chore.id)
    assert count == 7


@pytest.mark.asyncio
async def test_generates_weekly_assignments_for_correct_day(db):
    """A weekly chore created on a Monday should produce 1 assignment for the week
    starting on that same weekday."""
    cat = await make_category(db)
    parent = await make_user(db, "parent2", role="parent")  # type: ignore[arg-type]
    kid = await make_user(db, "kid2")

    # Chore created on a Monday → recurs on Mondays
    created_monday = datetime(2024, 4, 8, 9, 0, 0)
    chore = await make_chore(
        db, parent.id, cat.id,
        recurrence=Recurrence.weekly,
        created_at=created_monday,
    )
    await make_rule(db, chore.id, kid.id, Recurrence.weekly)
    await db.commit()

    week_start = date(2024, 4, 8)  # same Monday week
    await auto_generate_week_assignments(db, week_start)

    assignments = (await db.execute(
        select(ChoreAssignment).where(ChoreAssignment.chore_id == chore.id)
    )).scalars().all()
    assert len(assignments) == 1
    assert assignments[0].date == date(2024, 4, 8)


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_idempotent_generation_no_duplicate_rows(db):
    """Calling auto_generate_week_assignments twice must not duplicate rows."""
    cat = await make_category(db)
    parent = await make_user(db, "parent3", role="parent")  # type: ignore[arg-type]
    kid = await make_user(db, "kid3")

    chore = await make_chore(db, parent.id, cat.id, recurrence=Recurrence.daily)
    await make_rule(db, chore.id, kid.id, Recurrence.daily)
    await db.commit()

    week_start = date(2024, 4, 8)
    await auto_generate_week_assignments(db, week_start)
    first_count = await _count_assignments(db, chore.id)

    # Run a second time — must not create any new rows
    await auto_generate_week_assignments(db, week_start)
    second_count = await _count_assignments(db, chore.id)

    assert first_count == second_count == 7


@pytest.mark.asyncio
async def test_idempotent_with_rotation(db):
    """Idempotency holds when a rotation is involved."""
    cat = await make_category(db)
    parent = await make_user(db, "parent4", role="parent")  # type: ignore[arg-type]
    kid_a = await make_user(db, "kid_a")
    kid_b = await make_user(db, "kid_b")

    # Chore created on Monday → weekly cadence
    created_monday = datetime(2024, 4, 8, 9, 0, 0)
    chore = await make_chore(
        db, parent.id, cat.id,
        recurrence=Recurrence.weekly,
        created_at=created_monday,
    )
    # Rotation: kid_a is current (index 0)
    await make_rotation(
        db, chore.id, [kid_a.id, kid_b.id],
        cadence=RotationCadence.weekly,
        current_index=0,
        last_rotated=datetime(2024, 4, 8, 0, 0, 0),
    )
    await make_rule(db, chore.id, kid_a.id, Recurrence.weekly)
    await make_rule(db, chore.id, kid_b.id, Recurrence.weekly)
    await db.commit()

    week_start = date(2024, 4, 8)
    await auto_generate_week_assignments(db, week_start)
    first_count = await _count_assignments(db, chore.id)

    await auto_generate_week_assignments(db, week_start)
    second_count = await _count_assignments(db, chore.id)

    assert first_count == second_count


# ---------------------------------------------------------------------------
# Rotation filtering
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rotation_assigns_only_current_kid(db):
    """With a weekly rotation at index 0, only kid_a should receive an assignment
    for the reference week — not kid_b."""
    cat = await make_category(db)
    parent = await make_user(db, "parent5", role="parent")  # type: ignore[arg-type]
    kid_a = await make_user(db, "kid_c")
    kid_b = await make_user(db, "kid_d")

    created_monday = datetime(2024, 4, 8, 9, 0, 0)
    chore = await make_chore(
        db, parent.id, cat.id,
        recurrence=Recurrence.weekly,
        created_at=created_monday,
    )
    await make_rotation(
        db, chore.id, [kid_a.id, kid_b.id],
        cadence=RotationCadence.weekly,
        current_index=0,
        last_rotated=datetime(2024, 4, 8, 0, 0, 0),
    )
    await make_rule(db, chore.id, kid_a.id, Recurrence.weekly)
    await make_rule(db, chore.id, kid_b.id, Recurrence.weekly)
    await db.commit()

    week_start = date(2024, 4, 8)
    await auto_generate_week_assignments(db, week_start)

    kid_a_assignments = (await db.execute(
        select(ChoreAssignment).where(
            ChoreAssignment.chore_id == chore.id,
            ChoreAssignment.user_id == kid_a.id,
        )
    )).scalars().all()
    kid_b_assignments = (await db.execute(
        select(ChoreAssignment).where(
            ChoreAssignment.chore_id == chore.id,
            ChoreAssignment.user_id == kid_b.id,
        )
    )).scalars().all()

    assert len(kid_a_assignments) == 1
    assert len(kid_b_assignments) == 0


# ---------------------------------------------------------------------------
# Exclusions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_excluded_slot_is_not_recreated(db):
    """An explicit ChoreExclusion must prevent auto-generation for that slot."""
    from backend.models import ChoreExclusion

    cat = await make_category(db)
    parent = await make_user(db, "parent6", role="parent")  # type: ignore[arg-type]
    kid = await make_user(db, "kid_e")

    chore = await make_chore(db, parent.id, cat.id, recurrence=Recurrence.daily)
    await make_rule(db, chore.id, kid.id, Recurrence.daily)

    # Exclude Monday
    excluded_day = date(2024, 4, 8)
    db.add(ChoreExclusion(chore_id=chore.id, user_id=kid.id, date=excluded_day))
    await db.commit()

    week_start = date(2024, 4, 8)
    await auto_generate_week_assignments(db, week_start)

    assignments = (await db.execute(
        select(ChoreAssignment).where(ChoreAssignment.chore_id == chore.id)
    )).scalars().all()

    assigned_dates = {a.date for a in assignments}
    assert excluded_day not in assigned_dates
    assert len(assignments) == 6  # 7 days minus the excluded Monday
