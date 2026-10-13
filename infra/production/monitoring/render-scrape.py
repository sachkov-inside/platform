#!/usr/bin/env python3
"""Read one public connectivity setting; never source or print application secrets."""
import argparse
from pathlib import Path
from urllib.parse import urlsplit


def settings(path):
    if not path.exists():
        return {}
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if line.startswith(("TELEGRAM_LOOPBACK_PORT=", "WATCHDOG_TELEGRAM_APP_URL=")))


def render(root):
    watchdog = settings(root / "etc/inside/watchdog/watchdog.env")
    telegram = settings(root / "etc/inside/telegram/compose.env")
    if "WATCHDOG_TELEGRAM_APP_URL" in watchdog:
        address = urlsplit(watchdog["WATCHDOG_TELEGRAM_APP_URL"])
        if address.scheme != "http" or address.hostname != "127.0.0.1" or address.path not in ("", "/") or address.username or address.password or address.query or address.fragment:
            raise ValueError("WATCHDOG_TELEGRAM_APP_URL must be an HTTP loopback base URL")
        port = address.port or 80
    else:
        value = telegram.get("TELEGRAM_LOOPBACK_PORT", "")
        if not value.isascii() or not value.isdigit():
            raise ValueError("TELEGRAM_LOOPBACK_PORT is missing or invalid")
        port = int(value)
    if not 1 <= port <= 65535:
        raise ValueError("Telegram loopback port is out of range")
    return f'''global:
  scrape_interval: 60s
  scrape_timeout: 10s
scrape_configs:
  - job_name: host
    static_configs:
      - targets: ['127.0.0.1:9100']
  - job_name: telegram
    static_configs:
      - targets: ['127.0.0.1:{port}']
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: 'inside_telegram_[a-z_]+(_total|_seconds|_pending|_due|_backlog|_unknown|_restricted|_accepted|_duplicate|_processed|_ignored|_limited|_failed|_delivered|_rejected|_retryable|_success|_failure|_degraded)'
        action: keep
      - regex: '__name__|job|instance'
        action: labelkeep
  - job_name: victoria-metrics
    static_configs:
      - targets: ['127.0.0.1:8428']
  - job_name: grafana
    static_configs:
      - targets: ['127.0.0.1:3304']
'''


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/"))
    args = parser.parse_args()
    print(render(args.root), end="")
