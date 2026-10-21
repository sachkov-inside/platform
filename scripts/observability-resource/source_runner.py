"""Identical Resource source discovery with a closed, best-effort progress witness."""
from pathlib import Path
import sys
import unittest


def main():
    if sys.argv[1:]:raise ValueError('closed Resource source arguments refused')
    import source_progress
    suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern='test_*.py')
    source_progress.verify_inventory(suite)
    result=unittest.TextTestRunner(resultclass=source_progress.ProgressResult).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        print('resource-source: closed boundary failure',file=sys.stderr)
        sys.exit(1)
