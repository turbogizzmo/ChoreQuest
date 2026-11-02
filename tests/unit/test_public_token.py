"""Public dashboard token check and rate limiter pruning."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.models import AppSetting
from backend.rate_limit import SlidingWindowRateLimiter
from backend.routers import public


def _request(host):
    return SimpleNamespace(client=SimpleNamespace(host=host))


@pytest.mark.asyncio
async def test_wrong_tokens_are_rate_limited(db, monkeypatch):
    monkeypatch.setattr(public, "rate_limiter", SlidingWindowRateLimiter())
    db.add(AppSetting(key="dashboard_share_token", value="right-token"))
    await db.commit()

    await public._resolve_token("right-token", db, _request("1.2.3.4"))
    codes = []
    for _ in range(21):
        with pytest.raises(HTTPException) as exc:
            await public._resolve_token("guess", db, _request("1.2.3.4"))
        codes.append(exc.value.status_code)
    assert codes[:20] == [403] * 20 and codes[20] == 429
    # The right token still works from elsewhere
    await public._resolve_token("right-token", db, _request("5.6.7.8"))


def test_rate_limiter_prunes_stale_keys(monkeypatch):
    limiter = SlidingWindowRateLimiter()
    limiter.MAX_KEYS = 3
    clock = [1000.0]
    monkeypatch.setattr("backend.rate_limit.time.time", lambda: clock[0])
    for i in range(4):
        limiter.check(f"k{i}", 5, 60)
    clock[0] += 4000
    limiter.check("fresh", 5, 60)
    assert list(limiter._windows) == ["fresh"]
