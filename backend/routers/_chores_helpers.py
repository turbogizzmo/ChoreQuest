"""Helper functions extracted from backend/routers/chores.py.

These are internal utilities used across the chores router endpoints:
- _get_chore_or_404 / _reload_chore_with_category
- _reload_assignment_with_relations
- _quest_assigned_notification
- _build_rotation_summaries
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.models import (
    Chore,
    ChoreAssignment,
    ChoreRotation,
    User,
    Notification,
    NotificationType,
)
from backend.schemas import RotationSummary


async def get_chore_or_404(
    db: AsyncSession,
    chore_id: int,
    *,
    active_only: bool = True,
    load_category: bool = False,
) -> Chore:
    """Load a chore by ID, raising 404 if not found."""
    stmt = select(Chore).where(Chore.id == chore_id)
    if active_only:
        stmt = stmt.where(Chore.is_active == True)  # noqa: E712
    if load_category:
        stmt = stmt.options(selectinload(Chore.category))
    result = await db.execute(stmt)
    chore = result.scalar_one_or_none()
    if chore is None:
        raise HTTPException(status_code=404, detail="Chore not found")
    return chore


async def reload_chore_with_category(db: AsyncSession, chore_id: int) -> Chore:
    """Reload a chore with its category relationship eagerly loaded."""
    result = await db.execute(
        select(Chore)
        .where(Chore.id == chore_id)
        .options(selectinload(Chore.category))
    )
    return result.scalar_one()


async def reload_assignment_with_relations(
    db: AsyncSession, assignment_id: int
) -> ChoreAssignment:
    """Reload an assignment with chore (+ category) and user eagerly loaded."""
    result = await db.execute(
        select(ChoreAssignment)
        .where(ChoreAssignment.id == assignment_id)
        .options(
            selectinload(ChoreAssignment.chore).selectinload(Chore.category),
            selectinload(ChoreAssignment.user),
        )
    )
    return result.scalar_one()


def quest_assigned_notification(user_id: int, chore: Chore) -> Notification:
    """Build a 'quest assigned' notification for the given user."""
    return Notification(
        user_id=user_id,
        type=NotificationType.chore_assigned,
        title="New Quest Assigned!",
        message=f"You've been given a new quest: '{chore.title}' (+{chore.points} XP)",
        reference_type="chore",
        reference_id=chore.id,
    )


async def build_rotation_summaries(
    db: AsyncSession, chore_ids: list[int]
) -> dict[int, RotationSummary]:
    """Batch-load rotations for the given chore IDs and return a map of
    chore_id → RotationSummary (only for chores that have an active rotation)."""
    if not chore_ids:
        return {}

    rot_result = await db.execute(
        select(ChoreRotation).where(ChoreRotation.chore_id.in_(chore_ids))
    )
    rotations = rot_result.scalars().all()
    if not rotations:
        return {}

    # Gather all kid IDs referenced by any rotation
    all_kid_ids: set[int] = set()
    for r in rotations:
        all_kid_ids.update(r.kid_ids or [])

    kid_result = await db.execute(
        select(User.id, User.display_name).where(User.id.in_(all_kid_ids))
    )
    kid_names: dict[int, str] = {row.id: row.display_name for row in kid_result.all()}

    summaries: dict[int, RotationSummary] = {}
    for r in rotations:
        kid_ids = r.kid_ids or []
        if not kid_ids:
            continue
        idx = r.current_index % len(kid_ids)
        current_kid_id = kid_ids[idx]
        summaries[r.chore_id] = RotationSummary(
            current_kid_id=current_kid_id,
            current_kid_name=kid_names.get(current_kid_id, f"Kid #{current_kid_id}"),
            cadence=r.cadence,
            kid_ids=kid_ids,
            current_index=idx,
        )
    return summaries
