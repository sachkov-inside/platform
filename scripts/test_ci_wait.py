"""Exact-run CI observation at the GitHub CLI boundary; no workflow writes."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ci_wait', Path(__file__).with_name('ci-wait.py'))
ci_wait = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci_wait)


class WaitContracts(unittest.TestCase):
    def observe(self, *, run_changes=None, jobs=None, run_error=None, job_error=None):
        run = {'id': 42, 'head_sha': 'a'*40, 'event': 'pull_request', 'run_attempt': 1,
               'path': '.github/workflows/ci.yml', 'status': 'completed', 'conclusion': 'success',
               **(run_changes or {})}
        def read(path, budget):
            error = job_error if '/jobs?' in path else run_error
            if error is not None:
                raise error
            return jobs if '/jobs?' in path else run
        now = [0]
        return ci_wait.wait_run('owner/repo', 42, 'a'*40, 'pull_request', 1, 20,
                                read=read, clock=lambda: now[0],
                                sleep=lambda seconds: now.__setitem__(0, now[0]+seconds))

    def test_exact_completed_run_requires_real_gate_and_completed_jobs(self):
        run = {'id': 42, 'head_sha': 'a'*40, 'event': 'pull_request', 'run_attempt': 1,
               'path': '.github/workflows/ci.yml', 'status': 'completed', 'conclusion': 'success'}
        jobs = {'total_count': 2, 'jobs': [
            {'name': 'Unit tests', 'status': 'completed', 'conclusion': 'success'},
            {'name': 'CI Gate', 'status': 'completed', 'conclusion': 'success'}]}
        calls = []
        def read(path, budget):
            calls.append(path)
            return jobs if '/jobs?' in path else run
        result = ci_wait.wait_run('owner/repo', 42, 'a'*40, 'pull_request', 1, 30,
                                  read=read, clock=lambda: 0, sleep=lambda _: None)
        self.assertEqual(result['outcome'], 'success')
        self.assertEqual(calls, ['repos/owner/repo/actions/runs/42/attempts/1',
                                'repos/owner/repo/actions/runs/42/attempts/1/jobs?per_page=100&page=1'])

    def test_missing_run_is_terminal_and_distinct_from_network_failure(self):
        self.assertEqual(self.observe(run_error=ci_wait.MissingRun())['outcome'], 'missing-run')
        self.assertEqual(self.observe(run_error=ci_wait.NetworkError('network'))['outcome'], 'network-error')

    def test_running_run_exhausts_one_budget(self):
        self.assertEqual(self.observe(run_changes={'status': 'in_progress'})['outcome'], 'timeout')

    def test_old_success_or_other_event_attempt_workflow_is_rejected(self):
        for field, value in [('id', 41), ('head_sha', 'b'*40), ('event', 'merge_group'),
                             ('run_attempt', 2), ('path', '.github/workflows/other.yml')]:
            with self.subTest(field=field):
                self.assertEqual(self.observe(run_changes={field: value})['outcome'], 'identity-mismatch')

    def test_missing_gate_unfinished_jobs_and_partial_pages_cannot_pass(self):
        gate = {'name': 'CI Gate', 'status': 'completed', 'conclusion': 'success'}
        for jobs in [{'total_count': 0, 'jobs': []},
                     {'total_count': 1, 'jobs': [{**gate, 'status': 'in_progress'}]},
                     {'total_count': 2, 'jobs': []}]:
            with self.subTest(jobs=jobs):
                self.assertEqual(self.observe(jobs=jobs)['outcome'], 'incomplete-jobs')

    def test_jobs_404_after_observed_run_is_incomplete_jobs(self):
        self.assertEqual(self.observe(job_error=ci_wait.MissingRun())['outcome'], 'incomplete-jobs')

    def test_failed_job_is_not_hidden_by_successful_run_or_gate(self):
        jobs = {'total_count': 2, 'jobs': [
            {'name': 'CI Gate', 'status': 'completed', 'conclusion': 'success'},
            {'name': 'Unit tests', 'status': 'completed', 'conclusion': 'failure'}]}
        self.assertEqual(self.observe(jobs=jobs)['outcome'], 'failure')

    def test_real_api_request_bounds_native_timeout_and_recognizes_404(self):
        with patch.object(ci_wait.subprocess, 'run', return_value=type('Result', (), {
                'returncode': 1, 'stderr': 'gh: Not Found (HTTP 404)', 'stdout': ''})()) as run:
            with self.assertRaises(ci_wait.MissingRun):
                ci_wait.read_api('repos/owner/repo/actions/runs/42', 3)
            self.assertEqual(run.call_args.kwargs['timeout'], 3)


if __name__ == '__main__':
    unittest.main()
