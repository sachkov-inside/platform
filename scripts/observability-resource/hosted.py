"""No-secrets resource admission, exact-source image preparation and curated evidence."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import binding
import acquisition
import runtime
import disk_feedback

SCOPE = 'hosted short synthetic SDK-only comparison; acceptance pending; not physical-host capacity'
REPOSITORY = 'sachkov-inside/platform'


def context():
    for name in ('GITHUB_SHA', 'PILOT_PR_HEAD_SHA', 'PILOT_PR_BASE_SHA'):
        if not re.fullmatch(r'[a-f0-9]{40}', os.environ.get(name, '')):
            raise ValueError('provider_source_missing')
    if (os.environ.get('GITHUB_REPOSITORY') != REPOSITORY
            or os.environ.get('GITHUB_EVENT_NAME') != 'pull_request'
            or any(not re.fullmatch(r'[1-9][0-9]{0,19}', os.environ.get(name, ''))
                   for name in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))):
        raise ValueError('provider_context_missing')


def admission(metadata):
    context()
    return runtime.ci.admission(metadata, inputs=binding.inputs(), scope=SCOPE)


def decode_metadata(encoded):
    return acquisition.decode_json(encoded)


def metadata_source(metadata):
    if metadata.is_symlink() or not metadata.is_dir():
        raise ValueError('resource_metadata_required')
    values = {}
    for name in runtime.ci.METADATA_ARTIFACTS:
        path = metadata / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > binding.MAX_BYTES:
            raise ValueError('resource_metadata_required')
        values[name] = decode_metadata(path.read_text())
    source = values['source.json']
    fields = {'checkout_sha', 'checkout_tree', 'repository', 'run_id', 'run_attempt', 'event',
              'provider_execution_sha', 'provider_pr_head_sha', 'provider_pr_base_sha', 'inputs', 'scope'}
    if (not isinstance(source, dict) or set(source) != fields or source.get('scope') != SCOPE
            or source.get('repository') != REPOSITORY or source.get('event') != 'pull_request'
            or any(not isinstance(source.get(name), str) or not re.fullmatch(r'[a-f0-9]{40}', source[name])
                   for name in ('checkout_sha', 'checkout_tree', 'provider_execution_sha', 'provider_pr_head_sha', 'provider_pr_base_sha'))
            or source['checkout_sha'] != source['provider_execution_sha']
            or any(not isinstance(source.get(name), str) or not re.fullmatch(r'[1-9][0-9]{0,19}', source[name])
                   for name in ('run_id', 'run_attempt'))):
        raise ValueError('resource_source_contract')
    actual = binding.source(source['checkout_sha'], source['checkout_tree'])
    if source.get('inputs') != actual['inputs']:
        raise ValueError('resource_source_inputs_changed')
    for expression, field in (('HEAD', 'checkout_sha'), ('HEAD^{tree}', 'checkout_tree')):
        if runtime.ci.read_command(['git', '-C', str(binding.ROOT), 'rev-parse', expression]) != source[field]:
            raise ValueError('resource_checkout_changed')
    disk = values['admission.json']
    if not isinstance(disk, dict) or type(disk.get('ready')) is not bool:
        raise ValueError('resource_admission_contract')
    if set(disk) == {'ready', 'error_type'}:
        if disk['ready'] or disk['error_type'] not in ('OSError', 'ValueError', 'SubprocessError',
                'FileNotFoundError', 'PermissionError', 'NotADirectoryError', 'CalledProcessError', 'TimeoutExpired'):
            raise ValueError('resource_admission_contract')
    elif (set(disk) != {'storage_filesystem_path', 'ready', 'free_bytes', 'total_bytes', 'reason'}
            or not isinstance(disk['storage_filesystem_path'], str)
            or not Path(disk['storage_filesystem_path']).is_absolute()
            or any(type(disk.get(name)) is not int or disk[name] < 0 for name in ('free_bytes', 'total_bytes'))
            or {key: disk[key] for key in ('ready', 'free_bytes', 'total_bytes', 'reason')} !=
                runtime.ci.check_disk(total=disk['total_bytes'], free=disk['free_bytes'])):
        raise ValueError('resource_admission_contract')
    return source, disk


def collect(output, destination, *, metadata):
    source, _disk = metadata_source(metadata)
    acquisition_path = metadata / acquisition.NAME
    outcome = acquisition.read(acquisition_path, source['checkout_sha']) if acquisition_path.exists() or acquisition_path.is_symlink() else None
    numeric = disk_feedback.read(metadata / disk_feedback.NAME, source['checkout_sha'])
    # Typed numeric validation precedes generic copying; the raw file is never selected.
    runtime.ci.collect(output, metadata, destination, artifacts=binding.ARTIFACTS)
    if outcome is not None:
        acquisition.write(destination / acquisition.NAME, outcome, source['checkout_sha'])
    disk_feedback.write(destination / disk_feedback.NAME,numeric,source['checkout_sha'])
    owner_path = output / 'owner.json'
    acquired = False
    if owner_path.exists():
        if owner_path.is_symlink() or not owner_path.is_file() or owner_path.stat().st_size > binding.MAX_BYTES:
            raise ValueError('resource_owner_record')
        owner = json.loads(owner_path.read_text())
        if (not isinstance(owner, dict) or owner.get('cwd') != str(binding.ROOT)
                or not isinstance(owner.get('project'), str)
                or not re.fullmatch(r'inside-observability-resource-[0-9a-f]{12}', owner['project'])):
            raise ValueError('resource_owner_record')
        acquired = True
    binding.write(destination / 'resource-hosted.json', {'schema': 1,
        'state': 'registered_record_collected' if acquired else 'no_registered_project', 'acceptance': 'pending', 'scope': SCOPE})
    if not acquired:
        raise ValueError('resource_project_not_acquired')


def signal_group(group, signum):
    try:
        os.killpg(group, signum)
    except ProcessLookupError:
        return
    except PermissionError:
        # Verify absence of live processes after a permission refusal.
        # An unobservable or live group must retain the original refusal.
        result = subprocess.run(['ps', '-o', 'stat=', '-g', str(group)],
            capture_output=True, text=True, timeout=3)
        if (result.returncode not in (0, 1) or result.stderr or len(result.stdout) > 4096
                or any(not re.fullmatch(r'Z[A-Za-z+<]*', state) for state in result.stdout.split())):
            raise


def record_failure(recorder, error):
    if recorder is None:
        return
    if isinstance(error, (KeyboardInterrupt, SystemExit)):
        recorder.fail('interrupted')
    elif isinstance(error, (subprocess.TimeoutExpired, TimeoutError)):
        recorder.fail('command_deadline')
    elif isinstance(error, subprocess.CalledProcessError):
        recorder.fail('command_exit', error.returncode)
    elif isinstance(error, OSError):
        recorder.fail('io_failure')
    elif isinstance(error, ValueError):
        recorder.fail('refused')
    else:
        recorder.fail('unknown_failure')


def command(args, timeout, *, recorder=None, stage=None, kind=None):
    # Own the complete Docker CLI/plugin group, including timeout and interruption.
    process = None
    try:
        if recorder:
            recorder.start(stage, 'identity_probe')
        if args[0] == 'docker':
            runtime.pilot.assert_docker_identity()
        if recorder:
            recorder.start(stage, 'child_spawn', kind=kind)
        process = subprocess.Popen(runtime.pilot.docker_args(args), cwd=binding.ROOT,
            start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if recorder:
            recorder.start(stage, 'child_wait')
        status = process.wait(timeout=timeout)
        if status:
            if recorder:
                recorder.fail('command_exit', status)
            raise RuntimeError('resource_acquisition_failed')
        if recorder:
            recorder.passed(kind=kind)
    except BaseException as error:
        record_failure(recorder, error)
        raise
    finally:
        if process is not None:
            original_failure = sys.exc_info()[0] is not None
            if recorder:
                try:
                    recorder.start(stage, 'cleanup')
                except (OSError, ValueError):
                    pass
            cleanup_error = None
            for index, operation in enumerate((lambda: signal_group(process.pid, signal.SIGTERM),
                              lambda: process.wait(timeout=3),
                              lambda: signal_group(process.pid, signal.SIGKILL),
                              lambda: process.wait(timeout=3))):
                try:
                    operation()
                except BaseException as error:
                    # Preserve the existing tolerated grace timeout before forced stop.
                    if index == 1 and isinstance(error, subprocess.TimeoutExpired):
                        continue
                    if cleanup_error is None:
                        cleanup_error = error
            if recorder:
                recorder.cleanup_result(cleanup_error is None)
                if cleanup_error is None:
                    recorder.passed()
            if cleanup_error is not None and not original_failure:
                raise cleanup_error


def prepare(metadata, images):
    source, disk = metadata_source(metadata)
    recorder = acquisition.Recorder(metadata, source['checkout_sha'])
    numeric = disk_feedback.Record(source['checkout_sha'])
    try:
        prepare_images(source, disk, images, recorder, numeric)
    except BaseException as error:
        record_failure(recorder, error)
        raise
    finally:
        numeric.persist(metadata / disk_feedback.NAME)


def prepare_images(source, disk, images, recorder, numeric):
    if not isinstance(disk, dict) or disk.get('ready') is not True:
        raise ValueError('resource_disk_admission_required')
    if images.exists() or images.is_symlink():
        raise ValueError('resource_new_manifest_required')
    if runtime.ci.read_command(['git', '-C', str(binding.ROOT), 'status', '--porcelain']):
        raise ValueError('resource_clean_checkout_required')
    owner = 'inside-platform-production-smoke-cache-' + source['run_id'] + '-' + source['run_attempt']
    # Validate ownership/source before any Docker build or pull.
    runtime.fixture.images({'schema': 1, 'source': source['checkout_sha'], 'owner': owner,
                            'backend': 'sha256:' + 'a'*64, 'foundation': 'sha256:' + 'b'*64}, source['checkout_sha'])
    pins = json.loads((binding.ROOT / 'infra/observability/pilot/inputs.lock.json').read_text())['images']
    if set(pins) != set(runtime.pilot.SERVICES):
        raise ValueError('resource_preload_service_set')
    for image in pins.values():
        if not isinstance(image, str) or not re.fullmatch(r'[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}', image):
            raise ValueError('resource_digest_pin_required')
    recorder.start('daemon_identity', 'identity_probe')
    identity = runtime.pilot.daemon.identify(runtime.ci.read_command)
    runtime.pilot.FROZEN_DOCKER_ENDPOINT = identity['endpoint']
    runtime.pilot.FROZEN_DOCKER_IDENTITY = identity
    recorder.passed()
    numeric.attempt()
    with runtime.pilot.disk_budget(Path(identity['storage']), on_stop_reason=recorder.storage_stop,observe_samples=True) as samples:
        numeric.entered(samples)
        command(['docker', 'build', '--file', 'apps/backend/Dockerfile', '--target', 'backend-production',
                 '--build-arg', 'INSIDE_RELEASE_VERSION=v1', '--build-arg', 'INSIDE_SOURCE_SHA=' + source['checkout_sha'],
                 '--tag', owner + '-backend:v1', '.'], 600, recorder=recorder, stage='backend_build', kind='builds')
        numeric.after_backend_build()
        command(['docker', 'build', '--file', 'infra/production/database/Dockerfile',
                 '--tag', owner + '-foundation:local', 'infra/production/database'], 180,
                 recorder=recorder, stage='foundation_build', kind='builds')
        for service, image in pins.items():
            numeric.first_pull()
            command(['docker', 'pull', image], 90, recorder=recorder, stage='preload_'+service, kind='pulls')
        value = {'schema': 1, 'source': source['checkout_sha'], 'owner': owner}
        for key, suffix in (('backend', '-backend:v1'), ('foundation', '-foundation:local')):
            recorder.start(key+'_inspect', 'identity_probe')
            runtime.pilot.assert_docker_identity()
            recorder.start(key+'_inspect', 'inspection', kind='inspections')
            value[key] = runtime.pilot.command(['docker', 'image', 'inspect', owner + suffix, '--format', '{{.Id}}'], timeout=10).strip()
            recorder.passed(kind='inspections')
    numeric.persist(recorder.path.parent / disk_feedback.NAME)
    numeric.require()
    recorder.start('manifest_validate', 'validation')
    runtime.fixture.images(value, source['checkout_sha'])
    recorder.start('manifest_write', 'publication')
    descriptor = os.open(images, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(value, stream, allow_nan=False)
        stream.write('\n')
    recorder.start('complete', 'publication')
    recorder.passed()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('admission', 'prepare', 'collect'))
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--public', type=Path)
    parser.add_argument('--images', type=Path)
    args = parser.parse_args()
    if args.action == 'admission':
        return admission(args.metadata)
    if args.action == 'prepare' and args.images:
        prepare(args.metadata, args.images)
    elif args.action == 'collect' and args.output and args.public:
        collect(args.output, args.public, metadata=args.metadata)
    else:
        raise ValueError('resource_hosted_arguments')
    return 0


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda _signum, _frame: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print('resource-hosted: failed', file=sys.stderr)
        sys.exit(1)
