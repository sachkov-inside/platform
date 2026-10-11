"""Bounded, read-only observation of one exact Application CI run and attempt."""
import argparse
import json
import math
import re
import subprocess
import time

WORKFLOW_PATH = '.github/workflows/ci.yml'
API_TIMEOUT_SECONDS = 15
POLL_SECONDS = 10


class MissingRun(Exception):
    pass


class NetworkError(Exception):
    pass


def read_api(path, budget):
    try:
        result = subprocess.run(['gh', 'api', path], capture_output=True, text=True,
                                timeout=min(API_TIMEOUT_SECONDS, budget), check=False)
    except (subprocess.TimeoutExpired, OSError) as error:
        raise NetworkError(type(error).__name__) from error
    if result.returncode:
        if '(HTTP 404)' in result.stderr:
            raise MissingRun()
        raise NetworkError('GitHub API request failed')
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise NetworkError('Invalid GitHub API JSON') from error


def require_fields(value, fields):
    if not isinstance(value, dict) or any(
            name not in value or type(value[name]) is not kind for name, kind in fields.items()):
        raise NetworkError('Invalid GitHub API fields')
    return value


def wait_run(repo, run_id, sha, event, attempt, timeout, *, read=read_api,
             clock=time.monotonic, sleep=time.sleep):
    if (re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) is None or
            re.fullmatch(r'[a-f0-9]{40}', sha) is None or run_id < 1 or attempt < 1 or
            event not in ('pull_request', 'merge_group', 'workflow_call') or
            not math.isfinite(timeout) or timeout <= 0):
        raise ValueError('Invalid exact-run identity or timeout')
    deadline = clock() + timeout
    endpoint = f'repos/{repo}/actions/runs/{run_id}/attempts/{attempt}'
    last_error = None
    identity = {'runId': run_id, 'sha': sha, 'event': event, 'attempt': attempt}

    def request(path):
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError()
        return read(path, remaining)

    while clock() < deadline:
        run_observed = False
        try:
            run = require_fields(request(endpoint), {'id': int, 'head_sha': str, 'event': str,
                                 'run_attempt': int, 'path': str, 'status': str})
            if (run['id'], run['head_sha'], run['event'], run['run_attempt'], run['path']) != (
                    run_id, sha, event, attempt, WORKFLOW_PATH):
                return {**identity, 'outcome': 'identity-mismatch'}
            run_observed = True
            if run['status'] == 'completed':
                jobs = []
                page = 1
                while True:
                    data = require_fields(request(f'{endpoint}/jobs?per_page=100&page={page}'),
                                          {'total_count': int, 'jobs': list})
                    rows = [require_fields(row, {'name': str, 'status': str}) for row in data['jobs']]
                    jobs.extend(rows)
                    if len(jobs) >= data['total_count'] or not rows:
                        break
                    page += 1
                # A completed run with a missing gate or unfinished jobs is not a green result.
                gates = [job for job in jobs if job['name'] == 'CI Gate']
                if (len(jobs) != data['total_count'] or len(gates) != 1 or
                        any(job['status'] != 'completed' for job in jobs)):
                    return {**identity, 'outcome': 'incomplete-jobs'}
                success = run.get('conclusion') == 'success' and all(
                    job.get('conclusion') == 'success' for job in jobs)
                return {**identity, 'outcome': 'success' if success else 'failure',
                        'jobs': [{'name': job['name'], 'conclusion': job.get('conclusion')} for job in jobs]}
            last_error = None
        except MissingRun:
            return {**identity, 'outcome': 'incomplete-jobs' if run_observed else 'missing-run'}
        except NetworkError as error:
            last_error = str(error)
        except TimeoutError:
            break
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(POLL_SECONDS, remaining))
    return {**identity, 'outcome': 'network-error' if last_error is not None else 'timeout',
            **({'error': last_error} if last_error is not None else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--run-id', required=True, type=int)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--event', required=True, choices=['pull_request', 'merge_group', 'workflow_call'])
    parser.add_argument('--attempt', type=int, default=1)
    parser.add_argument('--timeout-seconds', type=float, default=1200)
    args = parser.parse_args()
    result = wait_run(args.repo, args.run_id, args.sha, args.event, args.attempt, args.timeout_seconds)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['outcome'] == 'success' else 1


if __name__ == '__main__':
    raise SystemExit(main())
