"""Finite aggregate-only SDK path observations. No result establishes SDK absence or acceptance."""
import math

NAMES = ('current','normalized','dotted','dotted_service','receiver','exporter')
COUNTERS = ('receiver','exporter')
MAX_SAFE_INTEGER = 2**53 - 1


def unknown_probe():
    return {'state':'invalid_response','queries':{name:{'state':'unknown','value':None} for name in NAMES}}


def parse_probe(value, *, now):
    if (type(now) not in (int,float) or not 0 < now <= MAX_SAFE_INTEGER or not math.isfinite(now)
            or not isinstance(value,dict) or set(value) != {'schema','queries'}
            or type(value['schema']) is not int or value['schema'] != 1
            or not isinstance(value['queries'],dict) or set(value['queries']) != set(NAMES)):
        return unknown_probe()
    rows = {}
    for name in NAMES:
        row = value['queries'][name]
        if (not isinstance(row,dict) or set(row) != {'state','value'} or row['state'] not in ('known','unknown')
                or row['state'] == 'unknown' and row['value'] is not None):
            return unknown_probe()
        number = row['value']
        if number is not None and (type(number) not in (int,float) or not 0 <= number <= MAX_SAFE_INTEGER or not math.isfinite(number)
                or name in COUNTERS and (number > MAX_SAFE_INTEGER or number != math.floor(number))
                or name not in COUNTERS and number > now + 2):
            return unknown_probe()
        rows[name] = {'state':row['state'],'value':number}
    return {'state':'valid','queries':rows}


def counter_delta(before, after):
    unknown = {'state':'unknown','delta':None,'progress_observed':None}
    if any(row['state'] != 'known' or row['value'] is None for row in (before,after)):
        return unknown
    if after['value'] < before['value']:
        return {'state':'reset','delta':None,'progress_observed':None}
    delta = int(after['value'] - before['value'])
    return {'state':'nondecreasing','delta':delta,'progress_observed':delta > 0}


def freshness(row, started):
    if (row['state'] != 'known' or type(started) not in (int,float)
            or not 0 < started <= MAX_SAFE_INTEGER or not math.isfinite(started)):
        return None
    return row['value'] is not None and row['value'] >= started


def facts(before, after, original, *, started):
    """Compare normalized parse_probe outputs; never return a causal or acceptance verdict."""
    fresh = {name:freshness(after['queries'][name],started) for name in NAMES if name not in COUNTERS}
    previous = None
    if (isinstance(original,dict) and set(original) == {'state','latest_seconds'} and original['state'] == 'known'
            and (original['latest_seconds'] is None or type(original['latest_seconds']) in (int,float)
                 and 0 < original['latest_seconds'] <= MAX_SAFE_INTEGER and math.isfinite(original['latest_seconds']))):
        previous = freshness({'state':'known','value':original['latest_seconds']},started)
    return {'interpretation':'observations_only','fresh':fresh,
            'current_fresh_after_original_missing_or_stale':None if previous is None or fresh['current'] is None else previous is False and fresh['current'] is True,
            'counters':{name:counter_delta(before['queries'][name],after['queries'][name]) for name in COUNTERS}}
