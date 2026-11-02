"""A trade proposal can only be accepted once."""

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend.models import (
    AssignmentStatus, ChoreAssignment, Notification, NotificationType, UserRole,
)
from backend.routers.calendar import accept_trade
from tests.unit.conftest import make_category, make_chore, make_user


def _proposal(to_user_id, assignment_id):
    return Notification(
        user_id=to_user_id, type=NotificationType.trade_proposed, title="t", message="m",
        reference_type="trade", reference_id=assignment_id,
    )


@pytest.mark.asyncio
async def test_second_proposal_cannot_take_assignment_from_new_owner(db):
    cat = await make_category(db)
    parent = await make_user(db, "p", UserRole.parent)
    a, b, c = await make_user(db, "ka"), await make_user(db, "kb"), await make_user(db, "kc")
    chore = await make_chore(db, parent.id, cat.id)
    asg = ChoreAssignment(chore_id=chore.id, user_id=a.id, date=date.today(), status=AssignmentStatus.pending)
    db.add(asg)
    await db.flush()
    to_b, to_c = _proposal(b.id, asg.id), _proposal(c.id, asg.id)
    db.add_all([to_b, to_c])
    await db.commit()

    with patch("backend.routers.calendar.ws_manager") as ws:
        ws.send_to_user = AsyncMock()
        ws.broadcast = AsyncMock()
        await accept_trade(to_b.id, b, db)
        with pytest.raises(HTTPException) as exc:
            await accept_trade(to_c.id, c, db)
        with pytest.raises(HTTPException):
            await accept_trade(to_b.id, b, db)

    assert exc.value.status_code == 400
    await db.refresh(asg)
    assert asg.user_id == b.id
