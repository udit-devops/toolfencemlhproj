"""Sliding-window rate limit behaviour, driven with explicit timestamps."""
from app.ratelimit import SlidingWindow


def test_window_blocks_at_limit_and_frees_slots_as_hits_expire():
    window = SlidingWindow(limit=2, span=60.0)
    for t in (0.0, 10.0):
        assert window.retry_after("a", t) is None
        window.record("a", t)
    assert window.retry_after("a", 20.0) == 41
    assert window.retry_after("b", 20.0) is None
    assert window.retry_after("a", 60.5) is None


def test_zero_limit_disables_window():
    window = SlidingWindow(limit=0, span=60.0)
    for t in range(100):
        assert window.retry_after("a", float(t)) is None
        window.record("a", float(t))
