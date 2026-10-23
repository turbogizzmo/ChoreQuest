"""Atomic XP balance changes.

Never do ``user.points_balance += n`` in Python: the ORM writes back an
absolute value, and the pysqlite driver doesn't open a transaction until the
first write, so two concurrent requests that both read the same balance
silently lose one update (double-spend on redeem, lost XP on award).

These helpers do the arithmetic in SQL and then reload the two balance
columns onto ``user`` so the rest of the request sees the committed values.
"""

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import User

_BALANCE_ATTRS = ["points_balance", "total_points_earned"]


async def credit_points(
    db: AsyncSession,
    user: User,
    amount: int,
    *,
    count_as_earned: bool = True,
) -> None:
    """Add ``amount`` XP to the balance (and lifetime total unless told not to)."""
    values = {"points_balance": User.points_balance + amount}
    if count_as_earned:
        values["total_points_earned"] = User.total_points_earned + amount
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    await db.refresh(user, _BALANCE_ATTRS)


async def debit_points(db: AsyncSession, user: User, amount: int) -> bool:
    """Subtract ``amount`` XP only if the balance covers it.

    Returns False (and changes nothing) when the balance is insufficient —
    the check and the write happen in one UPDATE, so concurrent debits
    can't both pass.
    """
    result = await db.execute(
        update(User)
        .where(User.id == user.id, User.points_balance >= amount)
        .values(points_balance=User.points_balance - amount)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        return False
    await db.refresh(user, _BALANCE_ATTRS)
    return True


async def deduct_points_floor_zero(db: AsyncSession, user: User, amount: int) -> None:
    """Subtract ``amount`` XP, clamping the balance at zero (used for reversals)."""
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(points_balance=func.max(0, User.points_balance - amount))
        .execution_options(synchronize_session=False)
    )
    await db.refresh(user, _BALANCE_ATTRS)
