from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import ChoreRotation
from backend.schemas import RotationCreate, RotationUpdate, RotationResponse
from backend.dependencies import require_parent
from backend.websocket_manager import ws_manager

router = APIRouter(prefix="/api/rotations", tags=["rotations"])


# ---------- GET / ----------
@router.get("", response_model=list[RotationResponse])
async def list_rotations(
    db: AsyncSession = Depends(get_db),
    _parent=Depends(require_parent),
):
    """List all chore rotations (parent+ only)."""
    result = await db.execute(select(ChoreRotation).order_by(ChoreRotation.id))
    rotations = result.scalars().all()
    return [RotationResponse.model_validate(r) for r in rotations]


# ---------- POST / ----------
@router.post("", response_model=RotationResponse, status_code=201)
async def create_rotation(
    body: RotationCreate,
    db: AsyncSession = Depends(get_db),
    _parent=Depends(require_parent),
):
    """Create a new chore rotation (parent+ only)."""
    if not body.kid_ids:
        raise HTTPException(status_code=400, detail="kid_ids must not be empty")

    # Check for existing rotation on same chore
    result = await db.execute(
        select(ChoreRotation).where(ChoreRotation.chore_id == body.chore_id)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A rotation already exists for this chore")

    # Set last_rotated to now so the first daily reset doesn't immediately
    # advance past kid_ids[0]. Without this, should_advance_rotation() sees
    # last_rotated=None → returns True → Kid A is skipped on the very first run.
    rotation = ChoreRotation(
        chore_id=body.chore_id,
        kid_ids=body.kid_ids,
        cadence=body.cadence,
        rotation_day=body.rotation_day,
        current_index=0,
        last_rotated=datetime.now(timezone.utc),
    )
    db.add(rotation)
    await db.commit()
    await db.refresh(rotation)
    await ws_manager.broadcast({"type": "data_changed", "data": {"entity": "rotation"}})
    return RotationResponse.model_validate(rotation)


# ---------- PUT /{id} ----------
@router.put("/{rotation_id}", response_model=RotationResponse)
async def update_rotation(
    rotation_id: int,
    body: RotationUpdate,
    db: AsyncSession = Depends(get_db),
    _parent=Depends(require_parent),
):
    """Update an existing chore rotation (parent+ only)."""
    result = await db.execute(
        select(ChoreRotation).where(ChoreRotation.id == rotation_id)
    )
    rotation = result.scalar_one_or_none()
    if rotation is None:
        raise HTTPException(status_code=404, detail="Rotation not found")

    if body.kid_ids is not None:
        if not body.kid_ids:
            raise HTTPException(status_code=400, detail="kid_ids must not be empty")
        rotation.kid_ids = body.kid_ids
        # Reset index if it's now out of bounds
        if rotation.current_index >= len(body.kid_ids):
            rotation.current_index = 0

    if body.cadence is not None:
        rotation.cadence = body.cadence

    if body.rotation_day is not None:
        rotation.rotation_day = body.rotation_day
        # Reset last_rotated so the new boundary is measured from now,
        # giving the current kid the full period from the new rotation_day.
        rotation.last_rotated = datetime.now(timezone.utc)

    rotation.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rotation)
    await ws_manager.broadcast({"type": "data_changed", "data": {"entity": "rotation"}})
    return RotationResponse.model_validate(rotation)


# ---------- DELETE /{id} ----------
@router.delete("/{rotation_id}")
async def delete_rotation(
    rotation_id: int,
    db: AsyncSession = Depends(get_db),
    _parent=Depends(require_parent),
):
    """Delete a chore rotation (parent+ only)."""
    result = await db.execute(
        select(ChoreRotation).where(ChoreRotation.id == rotation_id)
    )
    rotation = result.scalar_one_or_none()
    if rotation is None:
        raise HTTPException(status_code=404, detail="Rotation not found")

    await db.delete(rotation)
    await db.commit()
    await ws_manager.broadcast({"type": "data_changed", "data": {"entity": "rotation"}})
    return {"detail": "Rotation deleted"}


# ---------- POST /{id}/advance ----------
@router.post("/{rotation_id}/advance", response_model=RotationResponse)
async def advance_rotation(
    rotation_id: int,
    db: AsyncSession = Depends(get_db),
    _parent=Depends(require_parent),
):
    """Manually advance a rotation to the next kid (parent+ only).
    Increments current_index, wrapping around the kid_ids length.
    """
    result = await db.execute(
        select(ChoreRotation).where(ChoreRotation.id == rotation_id)
    )
    rotation = result.scalar_one_or_none()
    if rotation is None:
        raise HTTPException(status_code=404, detail="Rotation not found")

    if not rotation.kid_ids:
        raise HTTPException(status_code=400, detail="Rotation has no kids to advance through")

    rotation.current_index = (rotation.current_index + 1) % len(rotation.kid_ids)
    rotation.last_rotated = datetime.now(timezone.utc)
    rotation.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(rotation)
    await ws_manager.broadcast({"type": "data_changed", "data": {"entity": "rotation"}})
    return RotationResponse.model_validate(rotation)
