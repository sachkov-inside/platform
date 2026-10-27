"""A failed Engine read must not discard the other owned containers' counters."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import engine


class EngineReadings(unittest.TestCase):
    def test_bounded_readers_make_progress_together_before_the_next_batch(self):
        barrier = threading.Barrier(4, timeout=2)
        lock = threading.Lock()
        active, maximum = 0, 0
        def fetch(endpoint, container):
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
            try:
                barrier.wait()
                return {'counters': engine.measurements.engine({}), 'started': 1, 'finished': 2}
            finally:
                with lock:
                    active -= 1
        containers = [format(index, '064x') for index in range(12)]
        with patch.object(engine, 'fetch', side_effect=fetch):
            value = engine.readings('unix:///fixture/docker.sock', containers)
        self.assertEqual(set(value), set(containers))
        self.assertEqual(maximum, 4)

    def test_one_unavailable_container_preserves_the_timed_record_and_others(self):
        containers = ['a' * 64, 'b' * 64]
        known = {'counters': engine.measurements.engine({'memory_stats': {'usage': 123}}),
                 'started': 1, 'finished': 2}
        def fetch(endpoint, container):
            if container == containers[0]:
                raise TimeoutError('private transport error')
            return known
        pilot = SimpleNamespace(restore_daemon=lambda owner: None,
                                assert_docker_identity=lambda: None,
                                FROZEN_DOCKER_ENDPOINT='unix:///fixture/docker.sock')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / 'owner.json').write_text(json.dumps({
                'cwd': str(engine.resource_profile.ROOT),
                'project': engine.resource_profile.PROJECT_PREFIX + '012345abcdef'}))
            (output / 'worker.json').write_text(json.dumps({'pid': 42, 'group': 42}))
            stdout = io.StringIO()
            with patch.dict(sys.modules, {'pilot': pilot}), \
                    patch.object(engine.os, 'getppid', return_value=42), \
                    patch.object(engine.os, 'getpgrp', return_value=42), \
                    patch.object(engine, 'fetch', side_effect=fetch), redirect_stdout(stdout):
                engine.main(output, containers)
        value = json.loads(stdout.getvalue())
        unavailable = value[containers[0]]
        self.assertEqual(set(unavailable), {'counters', 'started', 'finished'})
        self.assertEqual(unavailable['counters'], engine.measurements.engine({}))
        self.assertLessEqual(unavailable['started'], unavailable['finished'])
        self.assertEqual(value[containers[1]], known)
        self.assertNotIn('private transport error', stdout.getvalue())
