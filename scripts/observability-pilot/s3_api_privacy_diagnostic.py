"""Accept one bounded closed S3 privacy refusal, never arbitrary application logs."""
import json
import sys

from source_status import decode_json, InvalidResponse

MAX_BYTES = 512
FAILURE = 'S3 API privacy diagnostic unavailable'
REASONS = {'capture_shape', 'corpus_shape', 'document_count', 'document_bytes',
           'total_bytes', 'node_budget', 'depth_budget', 'malformed_json',
           'private_match', 'signing_match'}
PHASES = {'input', 'raw', 'token', 'decoded'}
LIMITS = {'documents': 33, 'totalBytes': 4_194_305, 'nodes': 100_001,
          'depth': 33, 'corpusEntries': 65}
FIELDS = {'event', 'reason', 'phase', *LIMITS}


class InvalidDiagnostic(ValueError):
    def __init__(self):
        super().__init__(FAILURE)


def parse(raw):
    """One JSON line, optional final LF, exact keys/enums and bounded integer counts."""
    try:
        if type(raw) is not bytes or len(raw) > MAX_BYTES:
            raise InvalidDiagnostic()
        line = raw[:-1] if raw.endswith(b'\n') else raw
        if b'\n' in line or b'\r' in line:
            raise InvalidDiagnostic()
        value = decode_json(line)
        if (type(value) is not dict or set(value) != FIELDS
                or value['event'] != 's3_api_privacy_guard'
                or type(value['reason']) is not str or value['reason'] not in REASONS
                or type(value['phase']) is not str or value['phase'] not in PHASES):
            raise InvalidDiagnostic()
        if any(type(value[key]) is not int or not 0 <= value[key] <= maximum
               for key, maximum in LIMITS.items()):
            raise InvalidDiagnostic()
        return value
    except (InvalidResponse, ValueError, TypeError, ArithmeticError):
        raise InvalidDiagnostic() from None


def main():
    try:
        if len(sys.argv) != 1:
            raise InvalidDiagnostic()
        value = parse(sys.stdin.buffer.read(MAX_BYTES + 1))
        print(json.dumps(value, separators=(',', ':')))
        return 0
    except (InvalidDiagnostic, OSError):
        print(FAILURE, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
