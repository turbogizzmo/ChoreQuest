"""Unit tests for streak-related edge cases.

The streak update logic lives in routers/chores.py but depends only on:
  - kid.last_streak_date
  - kid.current_streak / longest_streak
  - kid.streak_freezes_used / streak_freeze_month
  - is_vacation_day() DB query

We test the same logic via database-backed helpers that mirror what the
router does, keeping tests independent of the HTTP layer.
"""

from datetime import date, timedelta

import pytest

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import User, VacationPeriod, UserRole
from backend.routers.vacation import is_vacation_day

from tests.unit.conftest import make_user


# ---------------------------------------------------------------------------
# Streak helper — mirrors the logic in routers/chores.py verify_assignment()
# ---------------------------------------------------------------------------

async def _apply_streak(
    db: AsyncSession,
    kid: User,
    today: date,
) -> None:
    """Replicate the streak update block from the verify endpoint.

    Mutates *kid* in-place and flushes to the DB so subsequent queries
    see the updated state.
    """
    if kid.last_streak_date == today:
        pass  # already counted today
    elif kid.last_streak_date is not None:
        gap = (today - kid.last_streak_date).days
        if gap == 1:
            kid.current_streak += 1
            kid.last_streak_date = today
        elif gap > 1:
            all_vacation = True
            for offset in range(1, gap):
                gap_day = kid.last_streak_date + timedelta(days=offset)
                if not await is_vacation_day(db, gap_day):
                    all_vacation = False
                    break
            if all_vacation:
                kid.current_streak += 1
                kid.last_streak_date = today
            else:
                current_month = today.month + today.year * 12
                freeze_month = kid.streak_freeze_month or 0
                if kid.current_streak > 0 and freeze_month != current_month:
                    kid.streak_freezes_used = (kid.streak_freezes_used or 0) + 1
                    kid.streak_freeze_month = current_month
                    kid.current_streak += 1
                    kid.last_streak_date = today
                else:
                    kid.current_streak = 1
                    kid.last_streak_date = today
        else:
            # gap == 0 or negative: shouldn't happen in normal flow
            kid.current_streak = 1
            kid.last_streak_date = today
    else:
        kid.current_streak = 1
        kid.last_streak_date = today

    if kid.current_streak > kid.longest_streak:
        kid.longest_streak = kid.current_streak

    await db.flush()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestStreakGapOfOneDay:
    """A gap of exactly 1 day should extend the streak."""

    @pytest.mark.asyncio
    async def test_gap_one_day_increments_streak(self, db):
        yesterday = date(2024, 4, 9)
        kid = await make_user(db, "streak_kid1", current_streak=3, last_streak_date=yesterday)
        await db.commit()

        today = date(2024, 4, 10)
        await _apply_streak(db, kid, today)

        assert kid.current_streak == 4
        assert kid.last_streak_date == today

    @pytest.mark.asyncio
    async def test_first_completion_starts_streak(self, db):
        kid = await make_user(db, "streak_kid2", current_streak=0, last_streak_date=None)
        await db.commit()

        await _apply_streak(db, kid, date(2024, 4, 10))
        assert kid.current_streak == 1


class TestSameDayDoesNotDoubleCount:
    """Completing a chore a second time on the same day must not increment the streak."""

    @pytest.mark.asyncio
    async def test_same_day_no_increment(self, db):
        today = date(2024, 4, 10)
        kid = await make_user(db, "streak_kid3", current_streak=5, last_streak_date=today)
        await db.commit()

        await _apply_streak(db, kid, today)
        assert kid.current_streak == 5


class TestGapBreaksStreak:
    """A gap of more than 1 day (not covered by vacation) should reset streak to 1."""

    @pytest.mark.asyncio
    async def test_two_day_gap_resets_streak(self, db):
        # No vacation periods → gap breaks streak
        kid = await make_user(
            db, "streak_kid4", current_streak=7,
            last_streak_date=date(2024, 4, 7),
        )
        # Make sure streak_freeze_month is set to something already-used this month
        # so the freeze is not available
        current_month = date(2024, 4, 10).month + date(2024, 4, 10).year * 12
        kid.streak_freeze_month = current_month
        await db.commit()

        await _apply_streak(db, kid, date(2024, 4, 10))  # gap = 3
        assert kid.current_streak == 1


class TestVacationPreservesStreak:
    """If all gap days fall within vacation periods, the streak should NOT break."""

    @pytest.mark.asyncio
    async def test_vacation_gap_preserves_streak(self, db):
        parent = await make_user(db, "vac_parent", role=UserRole.parent)
        kid = await make_user(
            db, "streak_kid5", current_streak=5,
            last_streak_date=date(2024, 4, 8),
        )
        # Vacation covers 2024-04-09 and 2024-04-10 (the gap days before 2024-04-11)
        db.add(VacationPeriod(
            start_date=date(2024, 4, 9),
            end_date=date(2024, 4, 10),
            created_by=parent.id,
        ))
        await db.commit()

        # Kid completes a chore on 2024-04-11 — gap of 3 days but
        # days 2024-04-09 and 2024-04-10 are vacation → streak preserved
        await _apply_streak(db, kid, date(2024, 4, 11))
        assert kid.current_streak == 6
        assert kid.last_streak_date == date(2024, 4, 11)

    @pytest.mark.asyncio
    async def test_partial_vacation_gap_breaks_streak_with_freeze(self, db):
        """If only SOME gap days are vacation, the streak would break — but a
        streak freeze (1 per calendar month) absorbs the first break."""
        parent = await make_user(db, "vac_parent2", role=UserRole.parent)
        kid = await make_user(
            db, "streak_kid6", current_streak=4,
            last_streak_date=date(2024, 4, 8),
        )
        # Only one of the three gap days is a vacation day
        db.add(VacationPeriod(
            start_date=date(2024, 4, 9),
            end_date=date(2024, 4, 9),
            created_by=parent.id,
        ))
        await db.commit()

        # Gap = 3 days, only day 9 is vacation → not "all vacation"
        # Freeze is available (streak_freeze_month is None / 0)
        await _apply_streak(db, kid, date(2024, 4, 11))
        # Freeze consumed → streak continues
        assert kid.current_streak == 5
        assert kid.streak_freezes_used == 1


class TestStreakFreezeUsedOnce:
    """A streak freeze is only available once per calendar month."""

    @pytest.mark.asyncio
    async def test_freeze_not_reused_same_month(self, db):
        today = date(2024, 4, 15)
        current_month = today.month + today.year * 12

        kid = await make_user(
            db, "streak_kid7", current_streak=3,
            last_streak_date=date(2024, 4, 12),  # gap = 3
        )
        # Freeze already used this month
        kid.streak_freeze_month = current_month
        kid.streak_freezes_used = 1
        await db.commit()

        await _apply_streak(db, kid, today)
        # Freeze exhausted for April → streak resets
        assert kid.current_streak == 1


class TestLongestStreakTracking:
    """longest_streak should be updated when current_streak exceeds it."""

    @pytest.mark.asyncio
    async def test_longest_streak_updated(self, db):
        kid = await make_user(
            db, "streak_kid8", current_streak=9,
            last_streak_date=date(2024, 4, 9),
        )
        kid.longest_streak = 9
        await db.commit()

        await _apply_streak(db, kid, date(2024, 4, 10))
        assert kid.current_streak == 10
        assert kid.longest_streak == 10

    @pytest.mark.asyncio
    async def test_longest_streak_not_reduced_on_reset(self, db):
        """longest_streak must never decrease, even when current_streak resets."""
        today = date(2024, 4, 15)
        current_month = today.month + today.year * 12
        kid = await make_user(
            db, "streak_kid9", current_streak=5,
            last_streak_date=date(2024, 4, 10),  # gap = 5
        )
        kid.longest_streak = 5
        kid.streak_freeze_month = current_month  # freeze already spent
        await db.commit()

        await _apply_streak(db, kid, today)
        assert kid.current_streak == 1
        assert kid.longest_streak == 5  # unchanged
