"""Bounded, read-only observation of one exact Application CI run and attempt.

With --pr the command first binds the pull request's current head SHA and its latest
Application CI pull_request run and attempt, then observes that exact identity.
"""
import argparse
import json
import math
import re
import subprocess
import sys
import time

WORKFLOW_PATH = '.github/workflows/ci.yml'
API_TIMEOUT_SECONDS = 15
POLL_SECONDS = 10
LOG_TAIL_LINES = 60
PASSING_CONCLUSIONS = ('success', 'skipped')


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


def read_log(repo, job_id, budget):
    """Plain-text job log, or None when GitHub does not return it within the budget."""
    try:
        # gh refuses raw escape sequences; failure_report strips them before printing.
        result = subprocess.run(['gh', 'api', '--allow-escape-sequences',
                                 f'repos/{repo}/actions/jobs/{job_id}/logs'],
                                capture_output=True, text=True, errors='replace',
                                timeout=min(API_TIMEOUT_SECONDS, budget), check=False)
    except (subprocess.TimeoutExpired, OSError):
        return None
    return result.stdout if result.returncode == 0 else None


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
                # The real gate validates selected coverage. An excluded sibling is
                # skipped coverage, not a passing application check.
                success = (run.get('conclusion') == 'success' and
                           gates[0].get('conclusion') == 'success' and all(
                               job.get('conclusion') in ('success', 'skipped') for job in jobs))
                return {**identity, 'outcome': 'success' if success else 'failure',
                        'jobs': [{'name': job['name'], 'conclusion': job.get('conclusion'),
                                  **({'id': job['id']} if type(job.get('id')) is int else {})}
                                 for job in jobs]}
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


def pull_request_matches(run, pr):
    pulls = run.get('pull_requests')
    if not isinstance(pulls, list) or not pulls:
        return True
    return any(isinstance(pull, dict) and pull.get('number') == pr for pull in pulls)


def discover_pr_run(repo, pr, sha, timeout, *, read=read_api, clock=time.monotonic,
                    sleep=time.sleep):
    """Bind the pull request's current head and its latest Application CI run and attempt.

    Returns (identity, remaining seconds) or (terminal result, 0). An expected --sha that is
    not the current head is an identity mismatch; no run for the head within the budget is a
    missing run.
    """
    if (re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) is None or pr < 1 or
            (sha is not None and re.fullmatch(r'[a-f0-9]{40}', sha) is None) or
            not math.isfinite(timeout) or timeout <= 0):
        raise ValueError('Invalid pull request identity or timeout')
    deadline = clock() + timeout
    base = {'pr': pr, 'event': 'pull_request'}
    head = None
    last_error = None

    def request(path):
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError()
        return read(path, remaining)

    while clock() < deadline:
        try:
            if head is None:
                pull = require_fields(request(f'repos/{repo}/pulls/{pr}'), {'head': dict})
                head = require_fields(pull['head'], {'sha': str})['sha']
                if re.fullmatch(r'[a-f0-9]{40}', head) is None:
                    raise NetworkError('Invalid pull request head')
                if sha is not None and sha != head:
                    return {**base, 'sha': sha, 'headSha': head,
                            'outcome': 'identity-mismatch'}, 0
            data = require_fields(request(
                f'repos/{repo}/actions/workflows/{WORKFLOW_PATH.rsplit("/", 1)[1]}/runs'
                f'?head_sha={head}&event=pull_request&per_page=100'),
                {'workflow_runs': list})
            runs = [require_fields(row, {'id': int, 'head_sha': str, 'event': str,
                                         'run_attempt': int, 'path': str})
                    for row in data['workflow_runs']]
            # The latest run for the exact head; its run_attempt is the latest attempt.
            # GitHub lists the pull requests of a same-repository run; another pull request
            # with the same head commit tested a different base. Fork runs list none.
            runs = [run for run in runs if run['head_sha'] == head and
                    run['event'] == 'pull_request' and run['path'] == WORKFLOW_PATH and
                    pull_request_matches(run, pr)]
            if runs:
                run = max(runs, key=lambda row: row['id'])
                return {**base, 'runId': run['id'], 'sha': head,
                        'attempt': run['run_attempt']}, deadline - clock()
            last_error = None
        except MissingRun:
            return {**base, 'sha': head or sha, 'outcome': 'missing-run'}, 0
        except NetworkError as error:
            last_error = str(error)
        except TimeoutError:
            break
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(POLL_SECONDS, remaining))
    if head is not None and last_error is None:
        return {**base, 'sha': head, 'outcome': 'missing-run'}, 0
    return {**base, 'sha': head or sha,
            'outcome': 'network-error' if last_error is not None else 'timeout',
            **({'error': last_error} if last_error is not None else {})}, 0


def strip_control(text):
    """Remove terminal escape sequences and control characters other than tab and newline."""
    text = re.sub(r'(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)', '', text)
    # C1 controls (\x80-\x9f) include 8-bit CSI and OSC.
    return re.sub(r'[\x00-\x08\x0b-\x1f\x7f-\x9f]', '', text.replace('\r\n', '\n'))


def failure_report(repo, result, *, read_text=read_log, budget=API_TIMEOUT_SECONDS):
    """Failed job names and the tail of each failed job's log, for a human reader."""
    lines = []
    for job in result.get('jobs', []):
        if job.get('conclusion') in PASSING_CONCLUSIONS:
            continue
        lines.append(f"Failed job: {job['name']} ({job.get('conclusion')})")
        log = read_text(repo, job['id'], budget) if 'id' in job else None
        if log is None:
            lines.append('  log unavailable')
            continue
        tail = strip_control(log).rstrip('\n').split('\n')[-LOG_TAIL_LINES:]
        lines.extend(f'  {line}' for line in tail)
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--pr', type=int,
                        help='discover the current head run of this pull request')
    parser.add_argument('--run-id', type=int)
    parser.add_argument('--sha', help='full source SHA; with --pr, the expected current head')
    parser.add_argument('--event', choices=['pull_request', 'merge_group', 'workflow_call'])
    parser.add_argument('--attempt', type=int)
    parser.add_argument('--timeout-seconds', type=float, default=1200)
    args = parser.parse_args()
    if args.pr is not None:
        if args.run_id is not None or args.event is not None or args.attempt is not None:
            parser.error('--pr discovers the run, event and attempt; omit --run-id, --event and --attempt')
        identity, remaining = discover_pr_run(args.repo, args.pr, args.sha, args.timeout_seconds)
        if 'outcome' in identity:
            print(json.dumps(identity, ensure_ascii=False))
            return 1
        if remaining <= 0:
            print(json.dumps({**identity, 'outcome': 'timeout'}, ensure_ascii=False))
            return 1
        print(f"Observing run {identity['runId']} attempt {identity['attempt']} for "
              f"PR #{args.pr} head {identity['sha']}", file=sys.stderr)
        result = {'pr': args.pr, **wait_run(args.repo, identity['runId'], identity['sha'],
                                            'pull_request', identity['attempt'], remaining)}
    else:
        if args.run_id is None or args.sha is None or args.event is None:
            parser.error('provide --pr, or --run-id, --sha and --event')
        result = wait_run(args.repo, args.run_id, args.sha, args.event, args.attempt or 1,
                          args.timeout_seconds)
    if result['outcome'] == 'failure':
        for line in failure_report(args.repo, result):
            print(line, file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['outcome'] == 'success' else 1


if __name__ == '__main__':
    raise SystemExit(main())
