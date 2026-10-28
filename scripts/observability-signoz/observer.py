"""One fixed PostgreSQL migration read. Missing data never becomes zero."""
import json
import re

SQL = "SELECT json_build_object('applied_migrations',(SELECT count(*) FROM public.migration),'migration_lock_rows',(SELECT count(*) FROM public.migration_lock))"
OPTIONS = 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=1000 -c lock_timeout=1000'
FIELDS = frozenset(('applied_migrations', 'migration_lock_rows'))
NATIVE_SECONDS = 10


def command(cid):
    if type(cid) is not str or re.fullmatch('[a-f0-9]{64}', cid) is None:
        raise ValueError('exact_owned_CID_required')
    return ['exec', '--env', OPTIONS, cid, 'psql', '--no-psqlrc', '--no-password',
            '--username=signoz', '--dbname=signoz', '--tuples-only', '--no-align',
            '--set=ON_ERROR_STOP=1', '--command', SQL]


def unique(pairs):
    value = dict(pairs)
    if len(value) != len(pairs): raise ValueError('duplicate_key')
    return value


def unavailable():
    return {'available': False}


def decode(raw):
    try:
        if type(raw) is not bytes or len(raw) > 1024: raise ValueError('bounded_output_required')
        value = json.loads(raw, object_pairs_hook=unique)
        if type(value) is not dict or set(value) != FIELDS: raise ValueError('closed_fields')
        if not all(type(v) is int and 0 <= v <= 1000000 for v in value.values()):
            raise ValueError('closed_numeric_counts')
        return {'available': True, 'counts': value}
    except (ValueError, UnicodeError):
        return unavailable()


def observe(owned):
    # validate binds CID, image, Created, labels, limits and mounts before the exec.
    owned.validate('postgres')
    try:
        return decode(owned.engine.call(command(owned.containers['postgres']), timeout=NATIVE_SECONDS).encode())
    except Exception:
        # The native Engine retains genuine exit/private bounded failure bytes separately.
        return unavailable()
