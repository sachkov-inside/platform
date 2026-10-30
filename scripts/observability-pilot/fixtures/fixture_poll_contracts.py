"""Separate virtual-clock contracts; never part of the Core discovery inventory."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fixtures.owned_scenario_process import await_fixture_fact


class Clock:
    def __init__(self):
        self.now = 40.0
        self.pauses = []

    def read(self):
        return self.now

    def pause(self, seconds):
        if seconds <= 0:
            raise AssertionError('poll wait must be positive')
        self.pauses.append(seconds)
        self.now += seconds


class FixturePollingTests(unittest.TestCase):
    def test_immediate_fact_returns_original_value_without_waiting(self):
        clock = Clock()
        fact = object()
        self.assertIs(await_fixture_fact(lambda: fact, clock=clock.read, pause=clock.pause), fact)
        self.assertEqual(clock.pauses, [])

    def test_delayed_fact_is_observed_within_one_fixture_poll(self):
        clock = Clock()
        fact = object()
        def read():
            return fact if clock.now >= 40.025 else False
        self.assertIs(await_fixture_fact(read, clock=clock.read, pause=clock.pause), fact)
        self.assertLessEqual(clock.now, 40.035)
        self.assertTrue(clock.pauses)
        self.assertLessEqual(max(clock.pauses), .01)

    def test_read_crossing_deadline_cannot_succeed_or_start_another_wait(self):
        for value in (False, True):
            for elapsed in (1, 1.1):
                with self.subTest(value=value, elapsed=elapsed):
                    clock = Clock()
                    def read():
                        clock.now += elapsed
                        return value
                    with self.assertRaisesRegex(RuntimeError, 'before deadline'):
                        await_fixture_fact(read, clock=clock.read, pause=clock.pause)
                    self.assertEqual(clock.pauses, [])

    def test_absent_fact_and_negative_predicates_exhaust_one_absolute_second(self):
        for value in (False, None, 0, '', [], {}):
            with self.subTest(value=value):
                clock = Clock()
                reads = []
                def read():
                    reads.append(clock.now)
                    return value
                with self.assertRaisesRegex(RuntimeError, 'before deadline'):
                    await_fixture_fact(read, clock=clock.read, pause=clock.pause)
                self.assertAlmostEqual(clock.now, 41)
                self.assertTrue(reads)
                self.assertTrue(all(40 <= instant < 41 for instant in reads))
                self.assertLessEqual(max(clock.pauses), .01)

    def test_sleep_is_clipped_to_time_remaining_after_read(self):
        clock = Clock()
        reads = []
        def read():
            reads.append(clock.now)
            clock.now += .993
            return False
        with self.assertRaisesRegex(RuntimeError, 'before deadline'):
            await_fixture_fact(read, clock=clock.read, pause=clock.pause)
        self.assertEqual(reads, [40])
        self.assertEqual(len(clock.pauses), 1)
        self.assertAlmostEqual(clock.pauses[0], .007)
        self.assertAlmostEqual(clock.now, 41)

    def test_fact_available_at_deadline_is_never_read_or_accepted(self):
        clock = Clock()
        reads = []
        def read():
            reads.append(clock.now)
            return clock.now >= 41
        with self.assertRaisesRegex(RuntimeError, 'before deadline'):
            await_fixture_fact(read, clock=clock.read, pause=clock.pause)
        self.assertLess(max(reads), 41)
        self.assertAlmostEqual(clock.now, 41)

    def test_transient_oserror_retries_until_the_actual_fact(self):
        clock = Clock()
        fact = object()
        attempts = []
        def read():
            attempts.append(clock.now)
            if len(attempts) < 3:
                raise OSError('fixture not visible')
            return fact
        self.assertIs(await_fixture_fact(read, clock=clock.read, pause=clock.pause), fact)
        self.assertEqual(len(attempts), 3)
        self.assertAlmostEqual(clock.now, 40.02)

    def test_persistent_oserror_does_not_extend_deadline(self):
        clock = Clock()
        def read():
            raise OSError('fixture not visible')
        with self.assertRaisesRegex(RuntimeError, 'before deadline'):
            await_fixture_fact(read, clock=clock.read, pause=clock.pause)
        self.assertAlmostEqual(clock.now, 41)

    def test_unexpected_errors_and_interruptions_keep_original_objects(self):
        for error in (RuntimeError('read failed'), ValueError('predicate failed'),
                      KeyboardInterrupt(), SystemExit(23)):
            for boundary in ('read', 'predicate', 'pause'):
                with self.subTest(error=type(error).__name__, boundary=boundary):
                    clock = Clock()
                    def fail(*_):
                        raise error
                    class Fact:
                        def __bool__(self):
                            return fail()
                    read = fail if boundary == 'read' else lambda: Fact() if boundary == 'predicate' else False
                    pause = fail if boundary == 'pause' else clock.pause
                    with self.assertRaises(type(error)) as raised:
                        await_fixture_fact(read, clock=clock.read, pause=pause)
                    self.assertIs(raised.exception, error)

    def test_predicate_crossing_deadline_cannot_accept_the_fact(self):
        clock = Clock()
        class Fact:
            def __bool__(self):
                clock.now += 1
                return True
        with self.assertRaisesRegex(RuntimeError, 'before deadline'):
            await_fixture_fact(Fact, clock=clock.read, pause=clock.pause)
        self.assertEqual(clock.pauses, [])


if __name__ == '__main__':
    unittest.main()
