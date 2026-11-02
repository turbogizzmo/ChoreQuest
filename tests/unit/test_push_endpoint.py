"""Push endpoints must be public https URLs."""

import pytest

from backend.services.push import _send_one, is_safe_push_endpoint


@pytest.mark.parametrize("endpoint", [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
])
def test_real_push_services_allowed(endpoint):
    assert is_safe_push_endpoint(endpoint)


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://192.168.0.10:8122/api/admin",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/x",
    "https://localhost/x",
    "https://nas.local/x",
    "https://nas/x",
    "https://user:pw@fcm.googleapis.com/x",
    "file:///etc/passwd",
    "",
])
def test_internal_or_odd_endpoints_rejected(endpoint):
    assert not is_safe_push_endpoint(endpoint)


def test_send_drops_unsafe_stored_subscription():
    sub = {"endpoint": "https://192.168.0.10/x", "keys": {"p256dh": "a", "auth": "b"}}
    assert _send_one(sub, "{}", "priv", "pub", {"sub": "mailto:x@example.com"}) == "gone"
