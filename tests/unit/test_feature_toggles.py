"""Feature toggles are enforced by the backend, not just hidden in the UI."""

import pytest
from fastapi import HTTPException

from backend.dependencies import require_feature
from backend.models import AppSetting


@pytest.mark.asyncio
async def test_feature_on_by_default(db):
    await require_feature("chore_trading_enabled")(db)


@pytest.mark.asyncio
@pytest.mark.parametrize("value,blocked", [("false", True), ("true", False)])
async def test_feature_toggle_respected(db, value, blocked):
    db.add(AppSetting(key="spin_wheel_enabled", value=value))
    await db.commit()
    check = require_feature("spin_wheel_enabled")
    if blocked:
        with pytest.raises(HTTPException) as exc:
            await check(db)
        assert exc.value.status_code == 403
    else:
        await check(db)


def test_gated_routes_have_feature_dependency():
    from backend.main import app

    gated = {
        ("POST", "/api/calendar/trade"),
        ("POST", "/api/calendar/trade/{notification_id}/accept"),
        ("POST", "/api/spin/spin"),
        ("GET", "/api/stats/leaderboard"),
    }
    found = set()
    for route in app.routes:
        for method in getattr(route, "methods", ()) or ():
            if (method, route.path) in gated:
                names = [d.call.__qualname__ for d in route.dependant.dependencies]
                assert any("require_feature" in n for n in names), route.path
                found.add((method, route.path))
    assert found == gated
