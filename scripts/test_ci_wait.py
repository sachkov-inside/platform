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

    def test_successful_real_gate_allows_excluded_skips_but_no_failed_gate(self):
        jobs = {'total_count': 2, 'jobs': [
            {'name': 'CI Gate', 'status': 'completed', 'conclusion': 'success'},
            {'name': 'Web E2E', 'status': 'completed', 'conclusion': 'skipped'}]}
        self.assertEqual(self.observe(jobs=jobs)['outcome'], 'success')
        for conclusion in ['failure', 'cancelled', 'skipped', None]:
            jobs['jobs'][0]['conclusion'] = conclusion
            self.assertEqual(self.observe(jobs=jobs)['outcome'], 'failure')

    def test_real_api_request_bounds_native_timeout_and_recognizes_404(self):
        with patch.object(ci_wait.subprocess, 'run', return_value=type('Result', (), {
                'returncode': 1, 'stderr': 'gh: Not Found (HTTP 404)', 'stdout': ''})()) as run:
            with self.assertRaises(ci_wait.MissingRun):
                ci_wait.read_api('repos/owner/repo/actions/runs/42', 3)
            self.assertEqual(run.call_args.kwargs['timeout'], 3)


class PullRequestDiscoveryContracts(unittest.TestCase):
    head = 'c'*40

    def discover(self, *, pull=None, pages=None, sha=None, timeout=30):
        pages = list(pages if pages is not None else [{'workflow_runs': [
            {'id': 7, 'head_sha': self.head, 'event': 'pull_request', 'run_attempt': 2,
             'path': '.github/workflows/ci.yml'}]}])
        calls = []
        def read(path, budget):
            calls.append(path)
            if '/pulls/' in path:
                if isinstance(pull, Exception):
                    raise pull
                return pull or {'head': {'sha': self.head}}
            return pages.pop(0) if len(pages) > 1 else pages[0]
        now = [0]
        result = ci_wait.discover_pr_run('owner/repo', 5, sha, timeout, read=read,
                                         clock=lambda: now[0],
                                         sleep=lambda seconds: now.__setitem__(0, now[0]+seconds))
        return result, calls

    def test_binds_current_head_and_latest_exact_run_attempt(self):
        older = {'id': 3, 'head_sha': self.head, 'event': 'pull_request', 'run_attempt': 1,
                 'path': '.github/workflows/ci.yml'}
        latest = {**older, 'id': 9, 'run_attempt': 3}
        latest = {**latest, 'pull_requests': [{'number': 5}]}
        foreign = [{**latest, 'id': 20, 'head_sha': 'd'*40},
                   {**latest, 'id': 21, 'path': '.github/workflows/other.yml'},
                   {**latest, 'id': 22, 'event': 'merge_group'},
                   {**latest, 'id': 23, 'pull_requests': [{'number': 6}]}]
        (identity, remaining), calls = self.discover(
            pages=[{'workflow_runs': [older, latest, *foreign]}])
        self.assertEqual(identity, {'pr': 5, 'event': 'pull_request', 'runId': 9,
                                    'sha': self.head, 'attempt': 3})
        self.assertEqual(remaining, 30)
        self.assertEqual(calls, ['repos/owner/repo/pulls/5',
                                 f'repos/owner/repo/actions/workflows/ci.yml/runs?head_sha={self.head}'
                                 '&event=pull_request&per_page=100'])

    def test_waits_for_the_head_run_to_appear_within_one_budget(self):
        run = {'id': 7, 'head_sha': self.head, 'event': 'pull_request', 'run_attempt': 1,
               'path': '.github/workflows/ci.yml'}
        (identity, remaining), _ = self.discover(
            pages=[{'workflow_runs': []}, {'workflow_runs': [run]}])
        self.assertEqual(identity['runId'], 7)
        self.assertEqual(remaining, 20)
        (result, _), _ = self.discover(pages=[{'workflow_runs': []}])
        self.assertEqual(result['outcome'], 'missing-run')

    def test_expected_sha_must_be_the_current_head(self):
        (result, _), calls = self.discover(sha='e'*40)
        self.assertEqual(result['outcome'], 'identity-mismatch')
        self.assertEqual(result['headSha'], self.head)
        self.assertEqual(len(calls), 1)
        (identity, _), _ = self.discover(sha=self.head)
        self.assertEqual(identity['runId'], 7)

    def test_missing_pull_request_and_network_failures_are_distinct(self):
        (result, _), _ = self.discover(pull=ci_wait.MissingRun())
        self.assertEqual(result['outcome'], 'missing-run')
        (result, _), _ = self.discover(pull=ci_wait.NetworkError('network'))
        self.assertEqual(result['outcome'], 'network-error')

    def test_invalid_identity_is_rejected(self):
        for kwargs in [{'pr': 0, 'sha': None}, {'pr': 5, 'sha': 'short'}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                ci_wait.discover_pr_run('owner/repo', kwargs['pr'], kwargs['sha'], 10,
                                        read=lambda path, budget: {})


class FailureReportContracts(unittest.TestCase):
    def test_reports_failed_jobs_with_log_tail_and_skips_passing_jobs(self):
        result = {'outcome': 'failure', 'jobs': [
            {'name': 'CI Gate', 'conclusion': 'failure', 'id': 1},
            {'name': 'Unit tests', 'conclusion': 'failure', 'id': 2},
            {'name': 'Web E2E', 'conclusion': 'skipped', 'id': 3},
            {'name': 'Static', 'conclusion': 'success', 'id': 4},
            {'name': 'Integration', 'conclusion': 'cancelled'}]}
        logs = {1: None, 2: '\n'.join(f'line {n}' for n in range(100)) + '\n'}
        requested = []
        def read_text(repo, job_id, budget):
            requested.append((repo, job_id))
            return logs[job_id]
        lines = ci_wait.failure_report('owner/repo', result, read_text=read_text)
        self.assertEqual(requested, [('owner/repo', 1), ('owner/repo', 2)])
        self.assertEqual(lines[:2], ['Failed job: CI Gate (failure)', '  log unavailable'])
        self.assertEqual(lines[2], 'Failed job: Unit tests (failure)')
        self.assertEqual(lines[3], '  line 40')
        self.assertEqual(lines[3 + ci_wait.LOG_TAIL_LINES - 1], '  line 99')
        self.assertEqual(lines[-2:], ['Failed job: Integration (cancelled)', '  log unavailable'])

    def test_log_tail_strips_terminal_escape_sequences(self):
        result = {'jobs': [{'name': 'Static', 'conclusion': 'failure', 'id': 1}]}
        log = 'ok\r\n\x1b[31merror\x1b[0m\x1b]8;;http://x\x07link\x1b]8;;\x07\tdone\x00\n'
        lines = ci_wait.failure_report('owner/repo', result,
                                       read_text=lambda repo, job_id, budget: log)
        self.assertEqual(lines, ['Failed job: Static (failure)', '  ok', '  errorlink\tdone'])

    def test_real_log_request_allows_and_bounds_escape_sequences(self):
        with patch.object(ci_wait.subprocess, 'run', return_value=type('Result', (), {
                'returncode': 0, 'stderr': '', 'stdout': 'log'})()) as run:
            self.assertEqual(ci_wait.read_log('owner/repo', 7, 4), 'log')
            self.assertEqual(run.call_args.args[0], ['gh', 'api', '--allow-escape-sequences',
                                                     'repos/owner/repo/actions/jobs/7/logs'])
            self.assertEqual(run.call_args.kwargs['timeout'], 4)

    def test_completed_failure_keeps_job_ids_for_logs(self):
        run = {'id': 42, 'head_sha': 'a'*40, 'event': 'pull_request', 'run_attempt': 1,
               'path': '.github/workflows/ci.yml', 'status': 'completed', 'conclusion': 'failure'}
        jobs = {'total_count': 2, 'jobs': [
            {'id': 11, 'name': 'CI Gate', 'status': 'completed', 'conclusion': 'failure'},
            {'id': 12, 'name': 'Unit tests', 'status': 'completed', 'conclusion': 'failure'}]}
        result = ci_wait.wait_run('owner/repo', 42, 'a'*40, 'pull_request', 1, 30,
                                  read=lambda path, budget: jobs if '/jobs?' in path else run,
                                  clock=lambda: 0, sleep=lambda _: None)
        self.assertEqual(result['outcome'], 'failure')
        self.assertEqual([job['id'] for job in result['jobs']], [11, 12])


if __name__ == '__main__':
    unittest.main()
