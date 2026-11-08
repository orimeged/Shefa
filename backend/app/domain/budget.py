"""A cap on paid API calls."""

import threading
import time
from collections import deque


class CallBudget:
    """A sliding one-minute limit, so a burst on a public endpoint can't run up the bill."""

    def __init__(self, calls_per_minute: int) -> None:
        self._limit = calls_per_minute
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def try_spend(self) -> bool:
        now = time.monotonic()
        with self._lock:
            while self._calls and now - self._calls[0] > 60:
                self._calls.popleft()
            if len(self._calls) >= self._limit:
                return False
            self._calls.append(now)
            return True
