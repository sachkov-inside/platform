"""Cheap protocol partition contracts; never execute the native protocol fixtures."""
import io
import unittest

import protocol_runner


def cases(count=9):
    case_type = type('Synthetic', (unittest.TestCase,), {
        '__module__': __name__,
        **{f'test_{index:02}': lambda self: None for index in range(count)},
    })
    return [case_type(f'test_{index:02}') for index in range(count)]


class ProtocolRunner(unittest.TestCase):
    def test_nested_shuffled_cases_have_exact_deterministic_disjoint_coverage(self):
        original = cases()
        suite = unittest.TestSuite([
            unittest.TestSuite(original[5:][::-1]),
            unittest.TestSuite(original[:5][::-1]),
        ])
        groups = protocol_runner.partition(suite)
        self.assertEqual([[case._testMethodName for case in group] for group in groups], [
            ['test_00', 'test_04', 'test_08'], ['test_01', 'test_05'],
            ['test_02', 'test_06'], ['test_03', 'test_07'],
        ])
        self.assertEqual({id(case) for group in groups for case in group}, {id(case) for case in original})
        self.assertEqual(sum(map(len, groups)), len(original))
        self.assertEqual(groups, protocol_runner.partition(unittest.TestSuite(original)))

    def test_empty_structural_suites_do_not_remove_leaves_but_empty_inventory_is_refused(self):
        original = cases(4)
        self.assertEqual(protocol_runner.partition(unittest.TestSuite([unittest.TestSuite(), unittest.TestSuite(original)])), tuple((case,) for case in original))
        for count in range(4):
            with self.subTest(count=count), self.assertRaises(ValueError):
                protocol_runner.partition(unittest.TestSuite(cases(count)))

    def test_future_discovered_module_joins_complete_inventory(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'test_future_protocol.py').write_text('import unittest\nclass Future(unittest.TestCase):\n' + ''.join(f'    def test_{index}(self): pass\n' for index in range(5)))
            loader = unittest.TestLoader()
            groups = protocol_runner.partition(loader.discover(str(path), pattern='test_*.py'), loader.errors)
            self.assertEqual(sorted(case.id() for group in groups for case in group), [f'test_future_protocol.Future.test_{index}' for index in range(5)])
            self.assertEqual(tuple(map(len, groups)), (2, 1, 1, 1))

    def test_foreign_alias_duplicate_spoofed_missing_and_unbound_cases_are_refused(self):
        valid = cases(4)
        invalid = []
        foreign = unittest.TestSuite(valid); foreign._tests.append(object()); invalid.append(foreign)
        invalid.append(unittest.TestSuite([*valid, valid[0]]))
        invalid.append(unittest.TestSuite([*valid, type(valid[0])('test_00')]))
        for key, value in [('id', lambda self: 'forged.Case.test_00'), ('id', lambda self: None), ('id', None), ('_testMethodName', None), ('_testMethodName', 'runTest'), ('test_00', lambda: None)]:
            changed = cases(4)
            setattr(changed[0], key, value.__get__(changed[0], type(changed[0])) if key == 'id' and callable(value) else value)
            invalid.append(unittest.TestSuite(changed))
        spoof_type = type('Spoof', (type(valid[0]),), {'__module__': __name__, 'id': lambda self: unittest.TestCase.id(self)})
        invalid.append(unittest.TestSuite([spoof_type('test_00'), *valid[1:]]))
        nested = unittest.TestSuite(); nested.addTest(nested); invalid.append(nested)
        consumed = unittest.TestSuite(); consumed._tests.append(None); invalid.append(consumed)
        for suite in invalid:
            with self.subTest(suite_type=type(suite).__name__), self.assertRaises(ValueError):
                protocol_runner.partition(suite)

    def test_loader_errors_and_real_import_failure_are_refused(self):
        import tempfile
        from pathlib import Path
        with self.assertRaises(ValueError):
            protocol_runner.partition(unittest.TestSuite(cases(4)), ['loader error'])
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'test_broken_protocol.py').write_text('raise RuntimeError("synthetic import error")\n')
            loader = unittest.TestLoader()
            suite = loader.discover(directory, pattern='test_*.py')
            self.assertTrue(loader.errors)
            with self.assertRaises(ValueError): protocol_runner.partition(suite, loader.errors)
            with self.assertRaises(ValueError): protocol_runner.partition(suite)

    def test_cli_refuses_missing_unknown_duplicate_and_lookalike_options_before_discovery(self):
        from unittest.mock import patch
        invalid = [[], ['--group'], ['--other', '1'], ['--gro', '1'], ['--group=1'], ['--group', '1', '--group', '2'], ['--group', '1', '--exclude', 'test_x']]
        invalid += [['--group', value] for value in ('0', '5', '-1', '+1', ' 1', '1 ', '1.0', 'True', '01', '')]
        with patch.object(protocol_runner, 'discover', side_effect=AssertionError('must refuse before discovery')):
            for arguments in invalid:
                with self.subTest(arguments=arguments), self.assertRaises(ValueError): protocol_runner.main(arguments)

    def test_all_groups_execute_real_cases_and_preserve_failure_error_skip_and_fixtures(self):
        from unittest.mock import patch
        for outcome, expected in [('pass', 0), ('fail', 1), ('error', 1), ('skip', 0)]:
            for group in protocol_runner.GROUPS:
                events = []
                def method(self):
                    events.append('method')
                    if outcome == 'fail': self.fail('synthetic failure')
                    if outcome == 'error': raise RuntimeError('synthetic error')
                    if outcome == 'skip': self.skipTest('existing skip')
                fixture = type('Fixture', (unittest.TestCase,), {'__module__': __name__, 'setUpClass': classmethod(lambda cls: events.append('class setup')), 'tearDownClass': classmethod(lambda cls: events.append('class teardown')), 'setUp': lambda self: events.append('setup'), 'tearDown': lambda self: events.append('teardown'), **{f'test_{i}': method for i in range(4)}})
                groups = protocol_runner.partition(unittest.defaultTestLoader.loadTestsFromTestCase(fixture))
                with self.subTest(outcome=outcome, group=group), patch.object(protocol_runner, 'discover', return_value=groups), patch('sys.stderr', new=io.StringIO()):
                    self.assertEqual(protocol_runner.main(['--group', group]), expected)
                self.assertEqual(events, ['class setup', 'setup', 'method', 'teardown', 'class teardown'])

    def test_existing_skip_decorator_stays_a_skip_and_cli_failure_exits_nonzero(self):
        import subprocess
        from pathlib import Path
        fixture = type('Skipped', (unittest.TestCase,), {'__module__': __name__, **{f'test_{index}': unittest.skip('existing decorator')(lambda self: self.fail('must stay skipped')) for index in range(4)}})
        groups = protocol_runner.partition(unittest.defaultTestLoader.loadTestsFromTestCase(fixture))
        stream = io.StringIO()
        self.assertEqual(protocol_runner.run_group(groups, '1', stream), 0)
        self.assertIn('skipped=1', stream.getvalue())
        refused = subprocess.run([__import__('sys').executable, '-B', str(Path(protocol_runner.__file__)), '--group', '5'], capture_output=True, text=True, timeout=2)
        self.assertEqual(refused.returncode, 1)
        self.assertIn('Protocol refused', refused.stderr)
        for error in ('self.fail("failure")', 'raise RuntimeError("error")'):
            program = 'import sys, unittest; sys.path.insert(0, "scripts/observability-fullstack"); import protocol_runner\n' + 'class Broken(unittest.TestCase):\n' + f'    def test_broken(self): {error}\n' + 'sys.exit(protocol_runner.run_group(((Broken("test_broken"),),), "1"))\n'
            failed = subprocess.run([__import__('sys').executable, '-B', '-c', program], capture_output=True, text=True, timeout=2)
            self.assertEqual(failed.returncode, 1)
            self.assertIn('FAILED', failed.stderr)


# Exact inverse fixtures, never imported by production execution.
PROTOCOL_JOBS = """
  fullstack-protocol-shard:
    name: Whole-stack protocol group ${{ matrix.group }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    strategy:
      fail-fast: false
      matrix:
        group: [1, 2, 3, 4]
    steps:
      - name: Check out exact source
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          ref: ${{ github.sha }}
      - name: Use repository-pinned Node without application dependencies
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .node-version
          architecture: x64
      - name: Verify pinned host Node facts
        timeout-minutes: 1
        run: >-
          node --input-type=module -e '
          import { readFileSync } from "node:fs";
          const expected = "v" + readFileSync(".node-version", "utf8").trim();
          if (process.version !== expected || process.arch !== "x64" || process.platform !== "linux")
          throw new Error("Resource host Node contract refused");
          console.log(JSON.stringify({ node: process.version, architecture: process.arch, platform: process.platform }));
          '
      - name: Verify exact workflow checkout identity
        timeout-minutes: 1
        run: test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
      - name: Verify complete whole-stack protocol group
        timeout-minutes: 2
        run: bash scripts/heavy-check.sh python3 -B scripts/observability-fullstack/protocol_runner.py --group "${{ matrix.group }}"

  fullstack-protocol:
    name: Whole-stack protocol complete
    needs: [fullstack-protocol-shard]
    if: ${{ always() }}
    runs-on: ubuntu-24.04
    timeout-minutes: 1
    env:
      RESULT: ${{ needs.fullstack-protocol-shard.result }}
    steps:
      - name: Require all four provider results to succeed
        run: test "$RESULT" = success
"""
ORIGINAL_PROTOCOL_STEP = """      - name: Verify whole-stack admission, ownership and acceptance contracts
        timeout-minutes: 2
        run: bash scripts/heavy-check.sh python3 -B -m unittest discover -s scripts/observability-fullstack -p 'test_*.py'
"""
NATIVE_BODY_HASHES = {'resource': '3ba2360947b9cfe2690359f906a13b66619fe300367a6299c07c2e4f5842c2c3',
 'fullstack': '2579604dd24ba79cc3fdab101924402e6afef87d41b6a7964bf667b4ab9232c0',
 'stability': 'cc113b07ac72ae0b7142fac6e6fbd5e50d556882a90829a2f4e40a20851f6e61',
 'cpu-control': '11a5412b627fc07213d658360a142e71dd5b928f7664373231b0a1e17a530f6f'}


class WorkflowInverse(unittest.TestCase):
    def test_only_exact_scheduling_delta_restores_original_native_prefix_goldens(self):
        import hashlib
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/observability-resource.yml').read_text()
        restored = inverse_protocol_workflow(workflow)
        self.assertEqual(hashlib.sha256(restored.split('\n  stability:\n')[0].rstrip().encode()).hexdigest(), '1473ec8f69a7102099a27fe95fdae45ab4b0997c3b5ce708f7f9eef7e224faff')
        self.assertEqual(hashlib.sha256(restored.split('\n  cpu-control:\n')[0].encode()).hexdigest(), 'ca4ec8506cb187f7256421d910011d016d089bbe407f228c6ab8d436d26187d7')

    def test_unrelated_native_and_graph_mutations_are_never_normalized(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/observability-resource.yml').read_text()
        mutations = [
            ('needs: fullstack-protocol\n', ''),
            ('needs: fullstack-protocol', 'needs: [fullstack-protocol, foreign]'),
            ('needs: fullstack-protocol', 'needs: fullstack-protocol\n    needs: fullstack-protocol'),
            ('timeout-minutes: 60', 'timeout-minutes: 61'),
            ('fullstack.py cpu-control-run', 'fullstack.py cpu-control-collect'),
            ('fullstack.py diagnostic-run', 'fullstack.py diagnostic-collect'),
            ('<!-- monitoring-stability: run -->', '<!-- monitoring-stability: other -->'),
            ('<!-- monitoring-cpu-control: app-unlimited-v1 -->', '<!-- monitoring-cpu-control: other -->'),
            ('  cpu-control:', '  other-control:'),
            ('contents: read', 'contents: write'),
            ('actions/checkout@3d3c42', 'actions/checkout@000000'),
            ('persist-credentials: false', 'persist-credentials: true'),
            ('      - name: Bind complete source and existing disk admission', '      - name: Moved admission anchor'),
            ('group: [1, 2, 3, 4]', 'group: [1, 2, 3]'),
        ]
        for before, after in mutations:
            self.assertIn(before, workflow)
            with self.subTest(before=before), self.assertRaises(ValueError):
                inverse_protocol_workflow(workflow.replace(before, after, 1))


def inverse_protocol_workflow(source):
    """Test-only exact inverse; refuse every other byte of workflow drift."""
    import hashlib
    import re
    if source.count(PROTOCOL_JOBS) != 1 or not source.endswith(PROTOCOL_JOBS):
        raise ValueError('Missing or changed protocol predecessor jobs')
    original = source[:-len(PROTOCOL_JOBS)]
    names = re.findall(r'^  ([a-z][a-z0-9-]*):$', original.split('jobs:\n', 1)[1], re.M)
    if names != ['resource', 'fullstack', 'stability', 'cpu-control']:
        raise ValueError('Unexpected or duplicate native jobs')
    for name in names:
        anchor = f'  {name}:\n    needs: fullstack-protocol\n'
        if original.count(anchor) != 1:
            raise ValueError('Missing or changed native dependency')
        original = original.replace(anchor, f'  {name}:\n', 1)
    if '    needs:' in original or ORIGINAL_PROTOCOL_STEP in original:
        raise ValueError('Unexpected dependency or repeated discovery')
    anchors = {
        'fullstack': '      - name: Bind complete source and existing disk admission\n',
        'stability': '      - name: Require exact diagnostic marker in the strict PR context\n',
        'cpu-control': '      - name: Bind complete source and existing disk admission\n',
    }
    pieces = re.split(r'(?m)^  ([a-z][a-z0-9-]*):\n', original.split('jobs:\n', 1)[1])
    for index in range(1, len(pieces), 2):
        name, body = pieces[index:index + 2]
        if name in anchors:
            anchor = anchors[name]
            if body.count(anchor) != 1:
                raise ValueError('Changed protocol reinsertion anchor')
            body = body.replace(anchor, ORIGINAL_PROTOCOL_STEP + anchor, 1)
        if hashlib.sha256(body.encode()).hexdigest() != NATIVE_BODY_HASHES[name]:
            raise ValueError('Unrelated native workflow mutation')
        pieces[index + 1] = body
    restored = original.split('jobs:\n', 1)[0] + 'jobs:\n' + pieces[0] + ''.join(f'  {pieces[index]}:\n{pieces[index + 1]}' for index in range(1, len(pieces), 2))
    # Baseline adee9d2a workflow, not a replacement for either old golden.
    if hashlib.sha256(restored.encode()).hexdigest() != '138c548fc96e24a0282bcdaf41aa7be954f79f8523ab57accb208bcd7401f2cf':
        raise ValueError('Unrelated workflow header mutation')
    return restored
