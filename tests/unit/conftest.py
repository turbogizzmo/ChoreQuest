"""Shared pytest fixtures for backend unit tests.

Uses an in-memory SQLite database (aiosqlite) so tests are fast and
fully isolated — no files on disk, no shared state between test runs.
"""

import os
import pytest
import pytest_asyncio
from datetime import datetime, date

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

# Provide a minimal SECRET_KEY so backend.config does not sys.exit()
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key!")

from backend.database import Base  # noqa: E402 — must come after env var is set
from backend.models import (  # noqa: E402
    User, UserRole, Chore, ChoreCategory, ChoreAssignment, ChoreAssignmentRule,
    ChoreRotation, ChoreExclusion, RotationCadence, Recurrence, Difficulty,
    AssignmentStatus, VacationPeriod,
)


@pytest_asyncio.fixture()
async def db():
    """Provide a fresh in-memory SQLite async session for each test."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


# ---------------------------------------------------------------------------
# Convenience factories
# ---------------------------------------------------------------------------

async def make_category(db: AsyncSession, name: str = "General") -> ChoreCategory:
    cat = ChoreCategory(name=name, icon="🏠", colour="#aaaaaa")
    db.add(cat)
    await db.flush()
    return cat


async def make_user(
    db: AsyncSession,
    username: str,
    role: UserRole = UserRole.kid,
    *,
    current_streak: int = 0,
    last_streak_date: date | None = None,
) -> User:
    user = User(
        username=username,
        display_name=username[:10],
        password_hash="x",
        role=role,
        current_streak=current_streak,
        longest_streak=current_streak,
        last_streak_date=last_streak_date,
        streak_freezes_used=0,
    )
    db.add(user)
    await db.flush()
    return user


async def make_chore(
    db: AsyncSession,
    creator_id: int,
    category_id: int,
    *,
    recurrence: Recurrence = Recurrence.daily,
    title: str = "Test Chore",
    created_at: datetime | None = None,
) -> Chore:
    chore = Chore(
        title=title,
        points=10,
        difficulty=Difficulty.easy,
        category_id=category_id,
        recurrence=recurrence,
        created_by=creator_id,
        created_at=created_at or datetime(2024, 1, 1, 0, 0, 0),  # Monday
    )
    db.add(chore)
    await db.flush()
    return chore


async def make_rotation(
    db: AsyncSession,
    chore_id: int,
    kid_ids: list[int],
    cadence: RotationCadence = RotationCadence.weekly,
    *,
    current_index: int = 0,
    last_rotated: datetime | None = None,
    rotation_day: int = 0,
) -> ChoreRotation:
    rotation = ChoreRotation(
        chore_id=chore_id,
        kid_ids=kid_ids,
        cadence=cadence,
        current_index=current_index,
        last_rotated=last_rotated,
        rotation_day=rotation_day,
    )
    db.add(rotation)
    await db.flush()
    return rotation


async def make_rule(
    db: AsyncSession,
    chore_id: int,
    user_id: int,
    recurrence: Recurrence = Recurrence.daily,
) -> ChoreAssignmentRule:
    rule = ChoreAssignmentRule(
        chore_id=chore_id,
        user_id=user_id,
        recurrence=recurrence,
    )
    db.add(rule)
    await db.flush()
    return rule
