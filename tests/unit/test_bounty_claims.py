"""Unit tests for the bounty claim lifecycle: claim → complete → verify → reject."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from backend.models import (
    BountyBoardClaim, BountyClaimStatus, Chore, Difficulty, NotificationType,
    PointTransaction, Notification, Recurrence, UserRole,
)
from backend.routers.bounty import (
    claim_bounty, verify_bounty_claim, reject_bounty_claim,
)
from tests.unit.conftest import make_category, make_user


async def make_bounty_chore(db, creator_id: int, category_id: int, *, points: int = 20) -> Chore:
    chore = Chore(
        title="Test Bounty",
        points=points,
        difficulty=Difficulty.easy,
        category_id=category_id,
        recurrence=Recurrence.once,
        created_by=creator_id,
        is_bounty=True,
        is_active=True,
        created_at=datetime(2024, 1, 1),
    )
    db.add(chore)
    await db.flush()
    return chore


# ---------------------------------------------------------------------------
# claim_bounty
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_claim_bounty_creates_claim(db):
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_1", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_1")
    chore = await make_bounty_chore(db, parent.id, category.id)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        result = await claim_bounty(chore_id=chore.id, db=db, current_user=kid)

    assert result.chore_id == chore.id
    assert result.user_id == kid.id
    assert result.status == BountyClaimStatus.claimed


@pytest.mark.asyncio
async def test_claim_bounty_prevents_double_claim(db):
    from fastapi import HTTPException
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_2", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_2")
    chore = await make_bounty_chore(db, parent.id, category.id)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        await claim_bounty(chore_id=chore.id, db=db, current_user=kid)

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        with pytest.raises(HTTPException) as exc_info:
            await claim_bounty(chore_id=chore.id, db=db, current_user=kid)
    assert exc_info.value.status_code == 409


# ---------------------------------------------------------------------------
# verify_bounty_claim
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_verify_bounty_claim_awards_xp(db):
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_3", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_3")
    chore = await make_bounty_chore(db, parent.id, category.id, points=25)

    claim = BountyBoardClaim(
        chore_id=chore.id,
        user_id=kid.id,
        status=BountyClaimStatus.completed,
        claimed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(claim)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        mock_ws.send_to_user = AsyncMock()
        with patch("backend.routers.bounty._get_active_event_multiplier", return_value=1.0):
            result = await verify_bounty_claim(claim_id=claim.id, db=db, parent=parent)

    assert result.status == BountyClaimStatus.verified
    assert kid.points_balance == 25
    assert kid.total_points_earned == 25


@pytest.mark.asyncio
async def test_verify_bounty_creates_point_transaction(db):
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_4", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_4")
    chore = await make_bounty_chore(db, parent.id, category.id, points=15)

    claim = BountyBoardClaim(
        chore_id=chore.id,
        user_id=kid.id,
        status=BountyClaimStatus.completed,
        claimed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(claim)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        mock_ws.send_to_user = AsyncMock()
        with patch("backend.routers.bounty._get_active_event_multiplier", return_value=1.0):
            await verify_bounty_claim(claim_id=claim.id, db=db, parent=parent)

    txs = (await db.execute(
        select(PointTransaction).where(PointTransaction.user_id == kid.id)
    )).scalars().all()
    assert len(txs) == 1
    assert txs[0].amount == 15


@pytest.mark.asyncio
async def test_verify_bounty_splits_event_bonus_transaction(db):
    """Multiplier > 1 should produce two transactions: base + bonus."""
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_5", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_5")
    chore = await make_bounty_chore(db, parent.id, category.id, points=10)

    claim = BountyBoardClaim(
        chore_id=chore.id,
        user_id=kid.id,
        status=BountyClaimStatus.completed,
        claimed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(claim)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        mock_ws.send_to_user = AsyncMock()
        with patch("backend.routers.bounty._get_active_event_multiplier", return_value=2.0):
            await verify_bounty_claim(claim_id=claim.id, db=db, parent=parent)

    txs = (await db.execute(
        select(PointTransaction).where(PointTransaction.user_id == kid.id)
    )).scalars().all()
    assert len(txs) == 2
    amounts = sorted(t.amount for t in txs)
    assert amounts == [10, 10]  # base=10, bonus=10 (2x multiplier)
    assert kid.points_balance == 20


# ---------------------------------------------------------------------------
# reject_bounty_claim
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reject_bounty_resets_status_to_claimed(db):
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_6", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_6")
    chore = await make_bounty_chore(db, parent.id, category.id)

    claim = BountyBoardClaim(
        chore_id=chore.id,
        user_id=kid.id,
        status=BountyClaimStatus.completed,
        claimed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(claim)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        result = await reject_bounty_claim(claim_id=claim.id, db=db, parent=parent)

    assert result.status == BountyClaimStatus.claimed
    assert result.completed_at is None
    assert result.photo_proof_path is None


@pytest.mark.asyncio
async def test_reject_bounty_sends_bounty_rejected_notification(db):
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_7", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_7")
    chore = await make_bounty_chore(db, parent.id, category.id)

    claim = BountyBoardClaim(
        chore_id=chore.id,
        user_id=kid.id,
        status=BountyClaimStatus.completed,
        claimed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(claim)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        await reject_bounty_claim(claim_id=claim.id, db=db, parent=parent)

    notifs = (await db.execute(
        select(Notification).where(
            Notification.user_id == kid.id,
            Notification.type == NotificationType.bounty_rejected,
        )
    )).scalars().all()
    assert len(notifs) == 1


@pytest.mark.asyncio
async def test_reject_bounty_returns_kid_display_name(db):
    """reject_bounty_claim must pass the kid User to _build_claim."""
    category = await make_category(db)
    parent = await make_user(db, "bounty_parent_8", role=UserRole.parent)
    kid = await make_user(db, "bounty_kid_8")
    chore = await make_bounty_chore(db, parent.id, category.id)

    claim = BountyBoardClaim(
        chore_id=chore.id,
        user_id=kid.id,
        status=BountyClaimStatus.completed,
        claimed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(claim)
    await db.commit()

    with patch("backend.routers.bounty.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        result = await reject_bounty_claim(claim_id=claim.id, db=db, parent=parent)

    assert result.user_display_name == kid.display_name
