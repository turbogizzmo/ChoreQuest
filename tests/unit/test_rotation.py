"""Unit tests for backend/services/rotation.py.

Covers:
- week_start_for / monday_of_week calendar helpers
- should_advance_rotation for every cadence
- advance_rotation index wrapping
- get_rotation_kid_for_day projections (weekly, daily, fortnightly, monthly)
"""

from datetime import date, datetime, timezone, timedelta
from types import SimpleNamespace

import pytest

from backend.models import RotationCadence
from backend.services.rotation import (
    advance_rotation,
    get_rotation_kid_for_day,
    monday_of_week,
    should_advance_rotation,
    week_start_for,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rotation(
    kid_ids: list[int],
    cadence: RotationCadence,
    current_index: int = 0,
    last_rotated: datetime | None = None,
    rotation_day: int = 0,
) -> SimpleNamespace:
    """Create a lightweight stand-in for ChoreRotation for pure-logic tests.

    The rotation service functions only access plain attributes, so a
    SimpleNamespace is sufficient and avoids SQLAlchemy instrumentation.
    """
    return SimpleNamespace(
        kid_ids=kid_ids,
        cadence=cadence,
        current_index=current_index,
        last_rotated=last_rotated,
        rotation_day=rotation_day,
    )


# ---------------------------------------------------------------------------
# week_start_for / monday_of_week
# ---------------------------------------------------------------------------

class TestWeekStartFor:
    def test_monday_is_own_start(self):
        monday = date(2024, 4, 1)  # A Monday
        assert week_start_for(monday, 0) == monday

    def test_wednesday_returns_preceding_monday(self):
        wednesday = date(2024, 4, 3)
        assert week_start_for(wednesday, 0) == date(2024, 4, 1)

    def test_sunday_rotation_day(self):
        # rotation_day=6 means rotation advances on Sundays
        friday = date(2024, 4, 5)  # Friday
        # Last Sunday on or before this Friday is 2024-03-31
        assert week_start_for(friday, 6) == date(2024, 3, 31)

    def test_monday_of_week_alias(self):
        d = date(2024, 4, 4)  # Thursday
        assert monday_of_week(d) == week_start_for(d, 0)

    def test_same_day_as_rotation_day_returns_itself(self):
        # Tuesday = weekday 1
        tuesday = date(2024, 4, 2)
        assert week_start_for(tuesday, 1) == tuesday


# ---------------------------------------------------------------------------
# should_advance_rotation
# ---------------------------------------------------------------------------

class TestShouldAdvanceRotation:
    def test_never_rotated_returns_true(self):
        r = _rotation([1, 2], RotationCadence.weekly)
        assert should_advance_rotation(r, datetime(2024, 4, 10, tzinfo=timezone.utc))

    def test_daily_same_day_returns_false(self):
        last = datetime(2024, 4, 10, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.daily, last_rotated=last)
        assert not should_advance_rotation(r, datetime(2024, 4, 10, 23, 59, tzinfo=timezone.utc))

    def test_daily_next_day_returns_true(self):
        last = datetime(2024, 4, 10, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.daily, last_rotated=last)
        assert should_advance_rotation(r, datetime(2024, 4, 11, tzinfo=timezone.utc))

    def test_weekly_same_week_returns_false(self):
        # last_rotated on Monday 2024-04-08, now Thursday 2024-04-11 (same Mon-week)
        last = datetime(2024, 4, 8, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.weekly, last_rotated=last)
        assert not should_advance_rotation(r, datetime(2024, 4, 11, tzinfo=timezone.utc))

    def test_weekly_next_week_returns_true(self):
        last = datetime(2024, 4, 8, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.weekly, last_rotated=last)
        assert should_advance_rotation(r, datetime(2024, 4, 15, tzinfo=timezone.utc))

    def test_fortnightly_one_boundary_returns_false(self):
        last = datetime(2024, 4, 8, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.fortnightly, last_rotated=last)
        # One Monday boundary later (2024-04-15) → only 1 boundary → should NOT advance
        assert not should_advance_rotation(r, datetime(2024, 4, 15, tzinfo=timezone.utc))

    def test_fortnightly_two_boundaries_returns_true(self):
        last = datetime(2024, 4, 8, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.fortnightly, last_rotated=last)
        # Two Monday boundaries later (2024-04-22) → 2 boundaries → should advance
        assert should_advance_rotation(r, datetime(2024, 4, 22, tzinfo=timezone.utc))

    def test_monthly_same_month_returns_false(self):
        last = datetime(2024, 4, 1, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.monthly, last_rotated=last)
        assert not should_advance_rotation(r, datetime(2024, 4, 30, tzinfo=timezone.utc))

    def test_monthly_next_month_returns_true(self):
        last = datetime(2024, 4, 1, tzinfo=timezone.utc)
        r = _rotation([1, 2], RotationCadence.monthly, last_rotated=last)
        assert should_advance_rotation(r, datetime(2024, 5, 1, tzinfo=timezone.utc))


# ---------------------------------------------------------------------------
# advance_rotation
# ---------------------------------------------------------------------------

class TestAdvanceRotation:
    def test_index_increments(self):
        r = _rotation([10, 20, 30], RotationCadence.weekly, current_index=0)
        now = datetime(2024, 4, 10, tzinfo=timezone.utc)
        advance_rotation(r, now)
        assert r.current_index == 1
        assert r.last_rotated == now

    def test_index_wraps_around(self):
        r = _rotation([10, 20], RotationCadence.weekly, current_index=1)
        advance_rotation(r, datetime(2024, 4, 10, tzinfo=timezone.utc))
        assert r.current_index == 0

    def test_single_kid_stays_at_zero(self):
        r = _rotation([42], RotationCadence.weekly, current_index=0)
        advance_rotation(r, datetime(2024, 4, 10, tzinfo=timezone.utc))
        assert r.current_index == 0


# ---------------------------------------------------------------------------
# get_rotation_kid_for_day
# ---------------------------------------------------------------------------

class TestGetRotationKidForDay:
    """Verify the correct kid is projected for a future or past day."""

    # --- weekly ---

    def test_weekly_same_week_is_current_kid(self):
        # kid_ids=[10, 20], current_index=0 → kid 10 is "up"
        r = _rotation([10, 20], RotationCadence.weekly, current_index=0)
        reference = date(2024, 4, 8)   # Monday
        target = date(2024, 4, 10)     # Wednesday — same week
        assert get_rotation_kid_for_day(r, target, reference) == 10

    def test_weekly_next_week_is_next_kid(self):
        r = _rotation([10, 20], RotationCadence.weekly, current_index=0)
        reference = date(2024, 4, 8)
        target = date(2024, 4, 15)  # next Monday
        assert get_rotation_kid_for_day(r, target, reference) == 20

    def test_weekly_two_weeks_ahead_wraps(self):
        r = _rotation([10, 20], RotationCadence.weekly, current_index=0)
        reference = date(2024, 4, 8)
        target = date(2024, 4, 22)  # 2 weeks ahead → wraps back to kid 10
        assert get_rotation_kid_for_day(r, target, reference) == 10

    def test_weekly_three_kids_sequential(self):
        r = _rotation([10, 20, 30], RotationCadence.weekly, current_index=0)
        ref = date(2024, 4, 1)  # Monday
        assert get_rotation_kid_for_day(r, date(2024, 4, 8), ref) == 20
        assert get_rotation_kid_for_day(r, date(2024, 4, 15), ref) == 30
        assert get_rotation_kid_for_day(r, date(2024, 4, 22), ref) == 10

    # --- daily ---

    def test_daily_next_day_is_next_kid(self):
        r = _rotation([10, 20], RotationCadence.daily, current_index=0)
        ref = date(2024, 4, 8)
        assert get_rotation_kid_for_day(r, date(2024, 4, 9), ref) == 20

    def test_daily_wraps_after_full_cycle(self):
        r = _rotation([10, 20], RotationCadence.daily, current_index=0)
        ref = date(2024, 4, 8)
        assert get_rotation_kid_for_day(r, date(2024, 4, 10), ref) == 10

    # --- fortnightly ---

    def test_fortnightly_first_week_same_kid(self):
        r = _rotation([10, 20], RotationCadence.fortnightly, current_index=0)
        ref = date(2024, 4, 8)
        target = date(2024, 4, 12)  # same week
        assert get_rotation_kid_for_day(r, target, ref) == 10

    def test_fortnightly_second_week_still_same_kid(self):
        r = _rotation([10, 20], RotationCadence.fortnightly, current_index=0)
        ref = date(2024, 4, 8)
        target = date(2024, 4, 15)  # one Monday boundary — only 1 boundary
        assert get_rotation_kid_for_day(r, target, ref) == 10

    def test_fortnightly_third_week_switches(self):
        r = _rotation([10, 20], RotationCadence.fortnightly, current_index=0)
        ref = date(2024, 4, 8)
        target = date(2024, 4, 22)  # two Monday boundaries → offset 1
        assert get_rotation_kid_for_day(r, target, ref) == 20

    # --- monthly ---

    def test_monthly_same_month_is_current_kid(self):
        r = _rotation([10, 20], RotationCadence.monthly, current_index=0)
        ref = date(2024, 4, 1)
        assert get_rotation_kid_for_day(r, date(2024, 4, 30), ref) == 10

    def test_monthly_next_month_is_next_kid(self):
        r = _rotation([10, 20], RotationCadence.monthly, current_index=0)
        ref = date(2024, 4, 1)
        assert get_rotation_kid_for_day(r, date(2024, 5, 1), ref) == 20

    def test_monthly_wraps_after_full_cycle(self):
        r = _rotation([10, 20], RotationCadence.monthly, current_index=0)
        ref = date(2024, 4, 1)
        assert get_rotation_kid_for_day(r, date(2024, 6, 1), ref) == 10
