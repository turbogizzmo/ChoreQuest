"""Tests for build_rotation_summaries() — specifically that the rotation
summary shown on ChoreDetail stays in sync with the kid actually assigned
the chore by the week/calendar assignment generator.

Regression coverage for:
  GitHub issue #68 — ChoreDetail showed wrong kid as 'current' for rotation
  chores when the daily reset hadn't advanced current_index yet but the week
  generator had already projected and created the correct assignment.
"""

import pytest
import pytest_asyncio
from datetime import date, datetime, timedelta, timezone

from tests.unit.conftest import (
    make_category, make_chore, make_user, make_rotation,
)
from backend.models import RotationCadence
from backend.routers._chores_helpers import build_rotation_summaries
from backend.services.rotation import get_rotation_kid_for_day


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _monday(d: date) -> date:
    """Return the Monday of the week containing *d*."""
    return d - timedelta(days=d.weekday())


def _last_monday(today: date) -> date:
    return _monday(today) - timedelta(weeks=1)


# ---------------------------------------------------------------------------
# Core regression test — issue #68
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_summary_matches_assignment_when_advance_pending(db):
    """
    build_rotation_summaries() must agree with get_rotation_kid_for_day()
    when should_advance_rotation() is True (daily reset hasn't fired yet).

    Scenario
    --------
    Weekly rotation: [Kid1, Kid3], current_index=0, last_rotated=last Monday.
    Today is this Monday (new rotation period).

    The week generator projected Kid3 (index 1) and created the assignment.
    Before the daily reset fires, current_index is still 0 → Kid1.
    Old code returned Kid1.  New code must return Kid3.
    """
    cat = await make_category(db)
    parent = await make_user(db, "parent", role=__import__("backend.models", fromlist=["UserRole"]).UserRole.parent)
    kid1 = await make_user(db, "kid1")
    kid3 = await make_user(db, "kid3")
    chore = await make_chore(db, parent.id, cat.id)

    today = date.today()
    # Place last_rotated on last Monday so should_advance_rotation fires today
    last_rotated = datetime.combine(_last_monday(today), datetime.min.time()).replace(tzinfo=timezone.utc)

    rotation = await make_rotation(
        db,
        chore.id,
        kid_ids=[kid1.id, kid3.id],
        cadence=RotationCadence.weekly,
        current_index=0,          # still pointing to Kid1 — stale
        last_rotated=last_rotated,
        rotation_day=0,           # Monday
    )

    # What the assignment generator would have created today
    reference_day = last_rotated.date()
    projected_kid_id = get_rotation_kid_for_day(rotation, today, reference_day)

    # build_rotation_summaries must agree with the projection
    summaries = await build_rotation_summaries(db, [chore.id])
    assert chore.id in summaries, "Expected a summary for the chore"

    summary = summaries[chore.id]
    assert summary.current_kid_id == projected_kid_id, (
        f"Summary shows kid {summary.current_kid_id} but assignment generator "
        f"would create for kid {projected_kid_id}. "
        "ChoreDetail would tell an assigned kid 'it's not your turn'."
    )


@pytest.mark.asyncio
async def test_summary_correct_when_index_already_advanced(db):
    """
    When the daily reset HAS advanced current_index (last_rotated = today),
    build_rotation_summaries() should read current_index directly.
    """
    cat = await make_category(db)
    parent = await make_user(db, "parent2", role=__import__("backend.models", fromlist=["UserRole"]).UserRole.parent)
    kid1 = await make_user(db, "kid1b")
    kid3 = await make_user(db, "kid3b")
    chore = await make_chore(db, parent.id, cat.id)

    today = date.today()
    # Simulate: daily reset already ran today and advanced index to 1 → Kid3
    last_rotated = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)

    await make_rotation(
        db,
        chore.id,
        kid_ids=[kid1.id, kid3.id],
        cadence=RotationCadence.weekly,
        current_index=1,          # already advanced to Kid3
        last_rotated=last_rotated,
        rotation_day=0,
    )

    summaries = await build_rotation_summaries(db, [chore.id])
    assert chore.id in summaries
    assert summaries[chore.id].current_kid_id == kid3.id


@pytest.mark.asyncio
async def test_summary_empty_for_chore_without_rotation(db):
    """Chores with no rotation row should not appear in the summaries dict."""
    cat = await make_category(db)
    parent = await make_user(db, "parent3", role=__import__("backend.models", fromlist=["UserRole"]).UserRole.parent)
    chore = await make_chore(db, parent.id, cat.id)
    # No rotation created

    summaries = await build_rotation_summaries(db, [chore.id])
    assert chore.id not in summaries


@pytest.mark.asyncio
async def test_summary_daily_cadence_advance_pending(db):
    """Same regression check but for daily cadence rotation."""
    cat = await make_category(db)
    parent = await make_user(db, "parent4", role=__import__("backend.models", fromlist=["UserRole"]).UserRole.parent)
    kid1 = await make_user(db, "kid1c")
    kid3 = await make_user(db, "kid3c")
    chore = await make_chore(db, parent.id, cat.id)

    today = date.today()
    yesterday = today - timedelta(days=1)
    last_rotated = datetime.combine(yesterday, datetime.min.time()).replace(tzinfo=timezone.utc)

    rotation = await make_rotation(
        db,
        chore.id,
        kid_ids=[kid1.id, kid3.id],
        cadence=RotationCadence.daily,
        current_index=0,
        last_rotated=last_rotated,
    )

    reference_day = last_rotated.date()
    projected_kid_id = get_rotation_kid_for_day(rotation, today, reference_day)

    summaries = await build_rotation_summaries(db, [chore.id])
    assert chore.id in summaries
    assert summaries[chore.id].current_kid_id == projected_kid_id
