"""Bounded cached-image component check. No OTLP, network, ports or raw diagnostics.

Run through scripts/heavy-check.sh. This checks actual OTTL initialization, unlike
`alloy validate`; full storage/sentinel acceptance still belongs to the public pilot.
"""
import json
from pathlib import Path
import signal
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'infra/observability/pilot'
# The pinned Linux image includes Bash. Only its private loopback health socket is used.
HEALTH = r'''
/bin/alloy run /etc/alloy/config.alloy --storage.path=/tmp/alloy > /tmp/startup.log 2>&1 &
child=$!
trap 'kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true' EXIT
until (( SECONDS >= 12 )); do
  kill -0 "$child" 2>/dev/null || { echo alloy_initialization_failed; exit 1; }
  if { exec 3<>/dev/tcp/127.0.0.1/12345; } 2>/dev/null; then
    printf 'GET /-/ready HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3
    if read -r -t 1 status <&3 && [[ "$status" == *' 200 '* ]]; then
      echo alloy_ready
      exit 0
    fi
    exec 3<&-
    exec 3>&-
  fi
  # Poll the external readiness fact; the absolute 12-second deadline bounds it.
  sleep 0.1
done
echo alloy_readiness_deadline
exit 1
'''


def check():
    image = json.loads((CONFIG/'inputs.lock.json').read_text())['images']['alloy']
    name = 'obs1566-alloy-startup-' + uuid.uuid4().hex
    def interrupted(_signum, _frame):
        raise RuntimeError('component check interrupted')
    handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        result = subprocess.run(['docker', 'run', '--pull=never', '--name', name,
            '--network=none', '--user=65532:65532', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
            '--memory=512m', '--cpus=.25', '--pids-limit=128', '--log-driver=none',
            '--tmpfs', '/tmp:size=16777216', '--entrypoint', '/bin/bash',
            '--mount', f'type=bind,src={CONFIG}/config.alloy,dst=/etc/alloy/config.alloy,readonly',
            image, '-euc', HEALTH], capture_output=True, text=True, timeout=20)
        if result.returncode != 0 or result.stdout.strip() != 'alloy_ready':
            raise RuntimeError('pinned Alloy actual initialization/readiness failed')
    finally:
        # A unique name is registered before acquisition; cleanup also covers CLI timeout/interruption.
        for sig in handlers:
            signal.signal(sig, signal.SIG_IGN)
        removed = subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=10)
        remaining = subprocess.run(['docker', 'ps', '-aq', '--filter', f'name=^/{name}$'],
                                   capture_output=True, timeout=5)
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        if removed.returncode != 0 or remaining.returncode != 0 or remaining.stdout.strip():
            raise RuntimeError('owned Alloy component cleanup failed')


if __name__ == '__main__':
    try:
        check()
    except Exception:
        # Never render subprocess exceptions, argv, config or raw collector diagnostics.
        print('Alloy component startup check failed; no payload diagnostics retained')
        raise SystemExit(1) from None
    print('Alloy component startup/health passed; owned container removed')
