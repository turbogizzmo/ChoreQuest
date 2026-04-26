import random
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import (
    SpinResult,
    ChoreAssignment,
    AssignmentStatus,
    AppSetting,
    User,
    PointTransaction,
    PointType,
)
from backend.schemas import SpinResultResponse, SpinAvailabilityResponse
from backend.dependencies import get_current_user
from backend.achievements import check_achievements
from backend.websocket_manager import ws_manager
from backend.services.pet_leveling import award_pet_xp_db

router = APIRouter(prefix="/api/spin", tags=["spin"])

SPIN_MIN = 1
SPIN_MAX = 25

# Must mirror SEGMENTS in frontend SpinWheel.jsx — backend picks from
# these values so the wheel animation always matches the awarded points.
WHEEL_VALUES = [1, 5, 2, 10, 3, 15, 1, 25, 2, 5, 3, 10]


async def _can_spin_today(db: AsyncSession, user: User) -> tuple[bool, int | None, str | None]:
    """
    Determine if the user is eligible to spin today.

    Rules:
    1. The user must have satisfied all of today's assigned chores
       (or have no assignments today).
    2. The user must not already have a spin result for today.
    3. Resets at midnight — unfinished chores lock the spin until the next day.

    Whether "satisfied" means parent-verified or just kid self-reported is
    controlled by the ``spin_requires_verification`` app setting (default: true).
    When true, only ``verified`` status counts — kids cannot game the wheel by
    tapping "Mark Done" on chores they haven't actually completed.

    Returns (can_spin, last_result_points_or_none, reason_or_none).
    """
    today = date.today()

    # Get last spin result for display
    last_result: int | None = None
    last_spin_query = await db.execute(
        select(SpinResult)
        .where(SpinResult.user_id == user.id)
        .order_by(SpinResult.created_at.desc())
        .limit(1)
    )
    last_spin = last_spin_query.scalar_one_or_none()
    if last_spin is not None:
        last_result = last_spin.points_won

    # Check if already spun today
    result = await db.execute(
        select(SpinResult).where(
            SpinResult.user_id == user.id,
            SpinResult.spin_date == today,
        )
    )
    today_spin = result.scalar_one_or_none()

    if today_spin is not None:
        return False, last_result, "You already spun the wheel today! Come back tomorrow."

    # Load the spin_requires_verification setting (default: true)
    setting_result = await db.execute(
        select(AppSetting).where(AppSetting.key == "spin_requires_verification")
    )
    spin_setting = setting_result.scalar_one_or_none()
    requires_verification = (spin_setting is None) or (spin_setting.value != "false")

    # Statuses that count as "done" depends on the setting
    done_statuses = (
        (AssignmentStatus.verified,)
        if requires_verification
        else (AssignmentStatus.completed, AssignmentStatus.verified)
    )

    # Check today's chore assignments
    result = await db.execute(
        select(ChoreAssignment).where(
            ChoreAssignment.user_id == user.id,
            ChoreAssignment.date == today,
        )
    )
    today_assignments = result.scalars().all()

    # If no assignments today, eligible
    if not today_assignments:
        return True, last_result, None

    all_done = all(a.status in done_statuses for a in today_assignments)
    if not all_done:
        if requires_verification:
            # Distinguish between "not submitted yet" and "waiting on parent"
            awaiting_parent = sum(
                1 for a in today_assignments
                if a.status == AssignmentStatus.completed
            )
            truly_pending = sum(
                1 for a in today_assignments
                if a.status not in done_statuses and a.status != AssignmentStatus.completed
            )
            if truly_pending == 0 and awaiting_parent > 0:
                return (
                    False,
                    last_result,
                    f"Almost there! Waiting for a parent to verify {awaiting_parent} quest(s).",
                )
            pending = truly_pending
        else:
            pending = sum(1 for a in today_assignments if a.status not in done_statuses)
        return False, last_result, f"Complete all of today's quests to unlock the spin! {pending} remaining."
    return True, last_result, None


# ---------- GET /availability ----------
@router.get("/availability", response_model=SpinAvailabilityResponse)
async def check_availability(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check if the user can spin today."""
    can_spin, last_result, reason = await _can_spin_today(db, user)
    return SpinAvailabilityResponse(can_spin=can_spin, last_result=last_result, reason=reason)


# ---------- POST /spin ----------
@router.post("/spin", response_model=SpinResultResponse)
async def execute_spin(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Execute the daily spin. Validates eligibility, generates random XP, awards points."""
    can_spin, _, reason = await _can_spin_today(db, user)
    if not can_spin:
        raise HTTPException(
            status_code=400,
            detail=reason or "Cannot spin today.",
        )

    # Pick from the wheel segments so the frontend animation matches
    points_won = random.choice(WHEEL_VALUES)
    today = date.today()

    # Create spin result
    spin_result = SpinResult(
        user_id=user.id,
        points_won=points_won,
        spin_date=today,
    )
    db.add(spin_result)

    # Award XP via PointTransaction
    transaction = PointTransaction(
        user_id=user.id,
        amount=points_won,
        type=PointType.spin,
        description=f"Daily spin: won {points_won} XP",
        reference_id=None,
        created_by=None,
    )
    db.add(transaction)

    # Update user balance
    user.points_balance += points_won
    user.total_points_earned += points_won

    # Award pet XP alongside user XP
    await award_pet_xp_db(db, user, points_won)

    await db.commit()
    await db.refresh(spin_result)

    # Check achievements (non-blocking on failure)
    try:
        await check_achievements(db, user)
    except Exception:
        pass

    # Notify via WebSocket
    try:
        await ws_manager.send_to_user(user.id, {
            "type": "spin_result",
            "data": {"points_won": points_won},
        })
    except Exception:
        pass

    return SpinResultResponse(points_won=points_won)
