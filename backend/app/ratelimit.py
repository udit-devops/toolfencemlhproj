"""In-memory sliding-window rate limits that cap how fast a public deployment can spend Gemma quota."""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict, Optional

MAX_TRACKED_CLIENTS = 10_000


class SlidingWindow:
    """Allows at most `limit` hits per `span` seconds for each key. A limit of 0 disables the window."""

    def __init__(self, limit: int, span: float):
        self.limit = limit
        self.span = span
        self._hits: Dict[str, Deque[float]] = {}

    def retry_after(self, key: str, now: float) -> Optional[int]:
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - self.span:
            hits.popleft()
        if self.limit and len(hits) >= self.limit:
            return int(hits[0] + self.span - now) + 1
        return None

    def record(self, key: str, now: float) -> None:
        if not self.limit:
            return
        self._hits[key].append(now)
        if len(self._hits) > MAX_TRACKED_CLIENTS:
            self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > now - self.span}


class RateLimiter:
    def __init__(self, per_client_per_minute: int, global_per_hour: int):
        self._client = SlidingWindow(per_client_per_minute, 60.0)
        self._global = SlidingWindow(global_per_hour, 3600.0)
        self._lock = threading.Lock()

    def check(self, client: str) -> Optional[int]:
        """Count one request. Return None if it is allowed, else the seconds until a slot frees up."""
        now = time.monotonic()
        with self._lock:
            wait = self._client.retry_after(client, now) or self._global.retry_after("all", now)
            if wait is None:
                self._client.record(client, now)
                self._global.record("all", now)
            return wait
