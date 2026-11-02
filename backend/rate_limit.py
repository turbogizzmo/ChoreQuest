import time
from collections import defaultdict
from fastapi import HTTPException


class SlidingWindowRateLimiter:
    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)

    # Above this many keys, drop ones whose timestamps are all old so the
    # dict can't grow without bound (longest window in use is one hour)
    MAX_KEYS = 10_000
    MAX_WINDOW_SECONDS = 3600

    def _prune(self, now: float):
        cutoff = now - self.MAX_WINDOW_SECONDS
        for key in [k for k, ts in self._windows.items() if not ts or ts[-1] <= cutoff]:
            del self._windows[key]

    def check(self, key: str, max_requests: int, window_seconds: int):
        now = time.time()
        if len(self._windows) > self.MAX_KEYS:
            self._prune(now)
        cutoff = now - window_seconds
        self._windows[key] = [t for t in self._windows[key] if t > cutoff]
        if len(self._windows[key]) >= max_requests:
            retry_after = int(self._windows[key][0] + window_seconds - now) + 1
            raise HTTPException(
                status_code=429,
                detail="Too many requests",
                headers={"Retry-After": str(retry_after)},
            )
        self._windows[key].append(now)


rate_limiter = SlidingWindowRateLimiter()
