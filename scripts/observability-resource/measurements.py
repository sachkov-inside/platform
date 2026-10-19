"""Closed raw counters and paired statistics; None means UNKNOWN, never inferred zero."""
import math
import re


def counter(value):
    return value if type(value) is int and 0 <= value <= 2**63 - 1 else None


def engine(raw):
    def at(*keys):
        value = raw
        for key in keys:
            value = value.get(key) if isinstance(value, dict) else None
        return counter(value)
    charged = at('memory_stats', 'usage')
    inactive = at('memory_stats', 'stats', 'inactive_file')
    return {'cpu_total_ns': at('cpu_stats', 'cpu_usage', 'total_usage'),
            'cpu_online_count': at('cpu_stats', 'online_cpus') or None,
            'memory_charged_bytes': charged, 'memory_limit_bytes': at('memory_stats', 'limit'),
            'memory_file_bytes': at('memory_stats', 'stats', 'file'),
            'memory_active_file_bytes': at('memory_stats', 'stats', 'active_file'),
            'memory_inactive_file_bytes': inactive,
            'memory_working_set_bytes': charged - inactive if charged is not None and inactive is not None and charged >= inactive else None,
            'io_read_operations': None, 'io_write_operations': None}


def io_stat(text):
    """v2 per-device operations; no readable/accounted records means unsupported/UNKNOWN."""
    if not isinstance(text, str) or not text.strip() or len(text) > 16_384:
        return None, None
    read = write = 0
    devices = set()
    for line in text.splitlines():
        fields = line.split()
        if len(fields) < 3 or not re.fullmatch(r'[0-9]+:[0-9]+', fields[0]) or fields[0] in devices:
            return None, None
        devices.add(fields[0])
        values = {}
        for field in fields[1:]:
            match = re.fullmatch(r'([a-z]+)=([0-9]+)', field)
            if not match or match[1] in values:
                return None, None
            values[match[1]] = counter(int(match[2]))
        if values.get('rios') is None or values.get('wios') is None:
            return None, None
        read += values['rios']
        write += values['wios']
    return counter(read), counter(write)


def delta(first, last, key):
    a, b = counter(first.get(key)), counter(last.get(key))
    start, end = first.get('at_seconds'), last.get('at_seconds')
    if (first.get('container') != last.get('container') or a is None or b is None or b < a
            or not isinstance(start, (int, float)) or not isinstance(end, (int, float))
            or not math.isfinite(start) or not math.isfinite(end) or end <= start):
        return None
    return b - a


def percentile(values, quantile):
    if (not values or not 0 < quantile <= 1 or any(type(value) not in (int, float)
            or not math.isfinite(value) or value < 0 for value in values)):
        return None
    return sorted(values)[math.ceil(len(values) * quantile) - 1]


def overhead(off, on, label):
    a, b = ([sample for sample in samples if sample['label'] == label] for samples in (off, on))
    if not a or len(a) != len(b) or any(sample['outcome'] != 'ok' for sample in a + b):
        return None
    before, after = (percentile([sample['elapsed_ms'] for sample in samples], .95) for samples in (a, b))
    if before is None or before <= 0 or after is None:
        return None
    return (after / before - 1) * 100
