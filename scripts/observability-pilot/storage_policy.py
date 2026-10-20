"""One storage admission/stopping policy for Linux and OrbStack pilot boundaries."""

GIB = 1024**3
STOP_MARGIN_BYTES = 256 * 1024**2
FLOOR_BYTES = 10 * GIB
GROWTH_BYTES = 4 * GIB
CLEANUP_HEADROOM_BYTES = 2 * GIB
MINIMUM_FREE_BYTES = FLOOR_BYTES + GROWTH_BYTES + CLEANUP_HEADROOM_BYTES


def admission(*, total, free):
    ready = total > 0 and free >= MINIMUM_FREE_BYTES
    return {'ready':ready, 'free_bytes':free, 'total_bytes':total,
            'reason':'admitted for isolated smoke only' if ready else
            'pilot requires 16 GiB free: 10 GiB host floor, 4 GiB growth cap, 2 GiB cleanup headroom'}


class StorageBudgetExceeded(RuntimeError):
    def __init__(self, reason):
        super().__init__('pilot storage budget exceeded')
        self.reason = reason


def assert_budget(initial, free):
    floor = free <= FLOOR_BYTES + STOP_MARGIN_BYTES
    growth = initial - free >= GROWTH_BYTES - STOP_MARGIN_BYTES
    if floor or growth:
        raise StorageBudgetExceeded('floor_growth' if floor and growth else 'floor' if floor else 'growth')
