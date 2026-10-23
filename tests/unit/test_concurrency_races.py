"""Regression tests for read-then-write races on XP and quest status.

These use a real on-disk WAL database with two independent sessions (the
in-memory fixture gives each connection its own empty database). To make the
interleaving deterministic, session B is paused right after its first query —
so it holds a stale read — until session A's request has fully committed.
Without the atomic UPDATEs, B would award XP or spend points a second time.
"""

import asyncio
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.database import Base
from backend.models import (
    AssignmentStatus, ChoreAssignment, PointTransaction, PointType, Reward,
    RewardRedemption, User, UserRole,
)
from backend.routers.chores import parent_verify_assignment, verify_chore
from backend.routers.rewards import redeem_reward
from backend.services.balance import credit_points

from tests.unit.conftest import make_category, make_chore, make_user


@pytest_asyncio.fixture()
async def sessions(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'race.db'}",
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


def pause_after_first_query(session: AsyncSession, gate: asyncio.Event):
    """Make ``session`` hold its first query's (stale) result until ``gate`` is set."""
    original = session.execute
    calls = 0

    async def execute(*args, **kwargs):
        nonlocal calls
        result = await original(*args, **kwargs)
        calls += 1
        if calls == 1:
            await gate.wait()
        return result

    session.execute = execute


async def _run_a_then_stale_b(make_call_a, make_call_b, db_a, db_b):
    """Start B (which pauses holding a stale read), finish A, then let B continue."""
    gate = asyncio.Event()
    pause_after_first_query(db_b, gate)
    task_b = asyncio.create_task(make_call_b())
    await asyncio.sleep(0.05)  # let B run its first query and park
    result_a = await make_call_a()
    gate.set()
    try:
        result_b = await task_b
    except HTTPException as exc:
        result_b = exc
    return result_a, result_b


async def _seed_assignment(factory, status: AssignmentStatus):
    async with factory() as db:
        cat = await make_category(db)
        parent = await make_user(db, "race_parent", role=UserRole.parent)
        kid = await make_user(db, "race_kid")
        chore = await make_chore(db, parent.id, cat.id)  # 10 XP
        assignment = ChoreAssignment(
            chore_id=chore.id, user_id=kid.id, date=date.today(), status=status,
            completed_at=datetime.now(timezone.utc).replace(tzinfo=None),
            completion_count=1,
        )
        db.add(assignment)
        await db.commit()
        return parent.id, kid.id, chore.id, assignment.id


async def _kid_xp(factory, kid_id: int) -> tuple[int, int]:
    async with factory() as db:
        kid = (await db.execute(select(User).where(User.id == kid_id))).scalar_one()
        tx_count = (await db.execute(
            select(func.count()).select_from(PointTransaction)
            .where(PointTransaction.user_id == kid_id,
                   PointTransaction.type == PointType.chore_complete)
        )).scalar_one()
        return kid.points_balance, tx_count


# ---------------------------------------------------------------------------
# C1 — verify can't award twice
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrent_verify_awards_xp_once(sessions):
    parent_id, kid_id, chore_id, _ = await _seed_assignment(sessions, AssignmentStatus.completed)

    async with sessions() as db_a, sessions() as db_b:
        parent_a = await db_a.get(User, parent_id)
        parent_b = await db_b.get(User, parent_id)
        result_a, result_b = await _run_a_then_stale_b(
            lambda: verify_chore(chore_id=chore_id, kid_id=None, db=db_a, user=parent_a),
            lambda: verify_chore(chore_id=chore_id, kid_id=None, db=db_b, user=parent_b),
            db_a, db_b,
        )

    assert result_a.status == AssignmentStatus.verified
    assert isinstance(result_b, HTTPException) and result_b.status_code == 409
    assert await _kid_xp(sessions, kid_id) == (10, 1)


@pytest.mark.asyncio
async def test_concurrent_parent_verify_awards_xp_once(sessions):
    parent_id, kid_id, _, assignment_id = await _seed_assignment(sessions, AssignmentStatus.pending)

    async with sessions() as db_a, sessions() as db_b:
        parent_a = await db_a.get(User, parent_id)
        parent_b = await db_b.get(User, parent_id)
        result_a, result_b = await _run_a_then_stale_b(
            lambda: parent_verify_assignment(assignment_id=assignment_id, db=db_a, user=parent_a),
            lambda: parent_verify_assignment(assignment_id=assignment_id, db=db_b, user=parent_b),
            db_a, db_b,
        )

    assert result_a.status == AssignmentStatus.verified
    assert isinstance(result_b, HTTPException) and result_b.status_code == 409
    assert await _kid_xp(sessions, kid_id) == (10, 1)


# ---------------------------------------------------------------------------
# C2 — redeem can't double-spend; credits don't lose updates
# ---------------------------------------------------------------------------

async def _seed_reward(factory, *, balance: int, cost: int, stock: int | None):
    async with factory() as db:
        parent = await make_user(db, "redeem_parent", role=UserRole.parent)
        kid = await make_user(db, "redeem_kid")
        kid.points_balance = balance
        reward = Reward(title="Ice cream", point_cost=cost, stock=stock, created_by=parent.id)
        db.add(reward)
        await db.commit()
        return kid.id, reward.id


async def _redeem_twice(factory, kid_id: int, reward_id: int):
    async with factory() as db_a, factory() as db_b:
        kid_a = await db_a.get(User, kid_id)
        kid_b = await db_b.get(User, kid_id)  # stale balance, as in a real request
        return await _run_a_then_stale_b(
            lambda: redeem_reward(reward_id=reward_id, db=db_a, current_user=kid_a),
            lambda: redeem_reward(reward_id=reward_id, db=db_b, current_user=kid_b),
            db_a, db_b,
        )


async def _redemption_state(factory, kid_id: int, reward_id: int):
    async with factory() as db:
        kid = await db.get(User, kid_id)
        reward = await db.get(Reward, reward_id)
        redemptions = (await db.execute(
            select(func.count()).select_from(RewardRedemption)
            .where(RewardRedemption.user_id == kid_id)
        )).scalar_one()
        return kid.points_balance, reward.stock, redemptions


@pytest.mark.asyncio
async def test_concurrent_redeem_cannot_overspend(sessions):
    kid_id, reward_id = await _seed_reward(sessions, balance=60, cost=50, stock=None)

    _, result_b = await _redeem_twice(sessions, kid_id, reward_id)

    assert isinstance(result_b, HTTPException) and result_b.status_code == 400
    assert "Insufficient" in result_b.detail
    assert await _redemption_state(sessions, kid_id, reward_id) == (10, None, 1)


@pytest.mark.asyncio
async def test_concurrent_redeem_cannot_oversell_stock(sessions):
    kid_id, reward_id = await _seed_reward(sessions, balance=500, cost=50, stock=1)

    _, result_b = await _redeem_twice(sessions, kid_id, reward_id)

    assert isinstance(result_b, HTTPException) and result_b.status_code == 400
    assert "out of stock" in result_b.detail
    assert await _redemption_state(sessions, kid_id, reward_id) == (450, 0, 1)


@pytest.mark.asyncio
async def test_concurrent_credits_are_not_lost(sessions):
    async with sessions() as db:
        kid_id = (await make_user(db, "credit_kid")).id
        await db.commit()

    async with sessions() as db_a, sessions() as db_b:
        kid_a = await db_a.get(User, kid_id)
        kid_b = await db_b.get(User, kid_id)  # both read balance 0
        await credit_points(db_a, kid_a, 10)
        await db_a.commit()
        await credit_points(db_b, kid_b, 5)
        await db_b.commit()
        assert kid_b.points_balance == 15  # in-memory object reflects the DB

    async with sessions() as db:
        kid = await db.get(User, kid_id)
        assert (kid.points_balance, kid.total_points_earned) == (15, 15)
