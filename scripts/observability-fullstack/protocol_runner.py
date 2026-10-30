"""Execute one fixed group of the complete stdlib protocol discovery."""
import sys
import unittest
from pathlib import Path


GROUPS = ('1', '2', '3', '4', '5', '6', '7')
LATE_CASE = 'test_trace_sanitizer.Sanitizer.test_late_parser_owner_loss_reaps_every_born_identity_before_original_deadline'
START = Path(__file__).resolve().parent


def partition(suite, errors=()):
    """Validate the entire inventory before selecting any real case objects."""
    if errors:
        raise ValueError('Protocol discovery reported loader errors')
    objects = set()
    inventory = {}

    def visit(node):
        if id(node) in objects:
            raise ValueError('Repeated protocol object or suite cycle')
        objects.add(id(node))
        if type(node) is unittest.TestSuite:
            # Stdlib discovery emits empty structural suites for imported modules
            # without cases. They contribute no leaves; the full inventory must
            # still populate every group. Never discard a non-suite leaf.
            for child in node:
                visit(child)
            return
        if not isinstance(node, unittest.TestCase):
            raise ValueError('Foreign protocol discovery leaf')
        if isinstance(node, unittest.loader._FailedTest):
            raise ValueError('Protocol discovery import failed')
        name = getattr(node, '_testMethodName', None)
        if not isinstance(name, str) or not name.startswith(unittest.TestLoader.testMethodPrefix) or not name.isidentifier():
            raise ValueError('Invalid protocol method identity')
        method = getattr(node, name, None)
        declared = getattr(type(node), name, None)
        if not callable(method) or getattr(method, '__self__', None) is not node or getattr(method, '__func__', None) is not declared:
            raise ValueError('Protocol method is not bound to its case')
        expected = f'{type(node).__module__}.{type(node).__qualname__}.{name}'
        if not all(part.isidentifier() for part in expected.split('.')):
            raise ValueError('Invalid protocol case identity')
        identity = getattr(node, 'id', None)
        if type(node).id is not unittest.TestCase.id or getattr(identity, '__func__', None) is not unittest.TestCase.id:
            raise ValueError('Spoofed protocol case identity')
        identifier = identity()
        if not isinstance(identifier, str) or identifier != expected:
            raise ValueError('Spoofed protocol case identity')
        if identifier in inventory:
            raise ValueError('Duplicate protocol case ID')
        inventory[identifier] = node

    if type(suite) is not unittest.TestSuite:
        raise ValueError('Protocol discovery must return a stdlib suite')
    visit(suite)
    if LATE_CASE not in inventory:
        raise ValueError('Missing protected late-owner protocol case')
    identifiers = sorted(inventory)
    regular = [identifier for identifier in identifiers if identifier != LATE_CASE]
    # Keep all twelve physical late-owner scenarios together under their own
    # unchanged deadline at group 5. Every other discovered case joins the six
    # regular strides at groups 1/2/3/4/6/7, including future discovered cases.
    strides = tuple(tuple(inventory[identifier] for identifier in regular[index::6]) for index in range(6))
    groups = strides[:4] + ((inventory[LATE_CASE],),) + strides[4:]
    if not all(groups):
        raise ValueError('Every protocol group must be nonempty')
    grouped_ids = [case.id() for group in groups for case in group]
    if len(grouped_ids) != len(set(grouped_ids)) or set(grouped_ids) != set(identifiers):
        raise ValueError('Protocol partition lost or repeated coverage')
    return groups


def discover():
    loader = unittest.TestLoader()
    suite = loader.discover(str(START), pattern='test_*.py')
    return partition(suite, loader.errors)


def run_group(groups, group, stream=None):
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.TestSuite(groups[int(group) - 1]))
    return 0 if result.wasSuccessful() else 1


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    if len(arguments) != 2 or arguments[0] != '--group' or arguments[1] not in GROUPS:
        raise ValueError('Required syntax: --group {1,2,3,4,5,6,7}')
    return run_group(discover(), arguments[1])


if __name__ == '__main__':
    try:
        sys.exit(main())
    except ValueError as error:
        print(f'Protocol refused: {error}', file=sys.stderr)
        sys.exit(1)
