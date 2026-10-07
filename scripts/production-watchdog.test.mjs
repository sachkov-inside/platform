// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const watchdog = "infra/production/watchdog/inside-watchdog";
const now = 1_800_000_000;

describe("production watchdog", () => {
  it("stays silent on a healthy server", () => {
    const fixture = createFixture();
    try {
      assertRun(fixture);
      assert.equal(fixture.signals(), "");
      assert.equal(fixture.sent(), "");
    } finally {
      fixture.cleanup();
    }
  });

  it("signals a failure once, mutes repeats and reports the recovery in one line", () => {
    const fixture = createFixture();
    try {
      fixture.fake(
        "ps-inside-platform-production",
        "inside-platform-production-api-1\trunning\tUp 3 hours (unhealthy)\n",
      );
      assert.equal(assertRun(fixture), "");
      assert.match(
        assertRun(fixture, now + 60),
        /Отказ: Контейнер inside-platform-production-api-1: unhealthy/u,
      );
      assert.equal(assertRun(fixture, now + 90), "");
      fixture.fake(
        "ps-inside-platform-production",
        "inside-platform-production-api-1\trunning\tUp 3 hours (healthy)\n",
      );
      assert.match(
        assertRun(fixture, now + 120),
        /Восстановлено: Контейнер inside-platform-production-api-1: unhealthy/u,
      );
      assert.match(
        fixture.signals(),
        /release=v18 Отказ: .*\n.*release=v18 Восстановлено: /u,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("confirms a flapping check only after two failed runs in a row", () => {
    const fixture = createFixture();
    try {
      fixture.fake("ready-fail", "");
      assert.equal(assertRun(fixture), "");
      assert.match(
        assertRun(fixture, now + 60),
        /Отказ: Telegram \/ready не отвечает 200/u,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps a database signal while the database cannot be read", () => {
    const fixture = createFixture();
    try {
      fixture.fake("sql", healthySql.replace("purchases|0", "purchases|2"));
      assert.match(
        assertRun(fixture),
        /Отказ: Покупок без итога дольше порога: 2/u,
      );
      fixture.fake("sql-fail", "");
      assert.equal(assertRun(fixture, now + 60), "");
      assert.match(
        assertRun(fixture, now + 120),
        /Отказ: Сторож не может прочитать базу Platform/u,
      );
      assert.doesNotMatch(fixture.signals(), /Восстановлено: Покупок/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("reads the buyer journey, backup, host and log signals", () => {
    const fixture = createFixture();
    try {
      fixture.fake(
        "sql",
        [
          "purchases|0",
          "fulfillment|1",
          "notification_outbox|3",
          "email_effects|0",
          "billing_queue_idle|0",
          "",
        ].join("\n"),
      );
      fixture.fake(
        "backup-incr",
        `Result=exit-code\nExecMainExitTimestamp=@${String(now - 600)}\n`,
      );
      fixture.fake(
        "df",
        "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 100 90 10 90% /\n",
      );
      fixture.fake(
        "logs-inside-platform-production-api-1",
        '{"event":"request_completed","route":"/billing/tbank/notification","statusCode":400}\n' +
          '{"event":"queue_attention","status":"operator_attention"}\n',
      );
      const messages = assertRun(fixture);
      for (const expected of [
        /Оплат без выдачи доступа дольше 5 минут: 1/u,
        /Уведомлений в outbox дольше 10 минут: 3/u,
        /Бэкап incr завершился с результатом exit-code/u,
        /Диск занят на 90%/u,
        /Webhook банка отклонён: 1 за 5 минут/u,
        /api: operator_attention в журнале, 1 за 5 минут/u,
      ]) {
        assert.match(messages, expected);
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("signals a stale backup and a Telegram counter that rose", () => {
    const fixture = createFixture();
    try {
      assertRun(fixture);
      for (const kind of ["incr", "diff", "full"]) {
        fixture.fake(
          `backup-${kind}`,
          `Result=success\nExecMainExitTimestamp=@${String(now - 9 * 3600)}\n`,
        );
      }
      fixture.fake(
        "metrics",
        healthyMetrics.replace(
          "update_failed_total 4",
          "update_failed_total 5",
        ),
      );
      const messages = assertRun(fixture, now + 60);
      assert.match(messages, /Последний успешный бэкап 9 ч назад/u);
      assert.match(messages, /Бот не обработал обновления Telegram/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("delivers to Telegram through the relay and retries an undelivered signal", () => {
    const fixture = createFixture();
    try {
      fixture.config(
        "WATCHDOG_TELEGRAM_BOT_TOKEN=signals-test-token\nWATCHDOG_TELEGRAM_CHAT_ID=42\n",
      );
      fixture.fake("send-fail", "");
      fixture.fake(
        "df",
        "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 100 90 10 90% /\n",
      );
      assertRun(fixture);
      assert.equal(fixture.sent(), "");
      assert.ok(
        existsSync(resolve(fixture.root, "var/lib/inside/watchdog/outbox")),
      );

      rmSync(resolve(fixture.root, "fake/send-fail"));
      assertRun(fixture, now + 60);
      const sent = fixture.sent();
      assert.match(sent, /--resolve api\.telegram\.org:443:172\.30\.244\.2/u);
      assert.match(sent, /chat_id=42/u);
      assert.match(sent, /Inside production · v18/u);
      assert.match(sent, /Диск занят на 90%/u);
      assert.doesNotMatch(sent, /signals-test-token/u);
      assert.ok(
        !existsSync(resolve(fixture.root, "var/lib/inside/watchdog/outbox")),
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("ignores settings outside the watchdog namespace", () => {
    const fixture = createFixture();
    try {
      fixture.config("PATH=/nonexistent\nWATCHDOG_DISK_MAX_PERCENT=95\n");
      fixture.fake(
        "df",
        "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 100 90 10 90% /\n",
      );
      const result = runWatchdog(fixture, now);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /Ignoring an unknown watchdog setting/u);
      assert.equal(fixture.signals(), "");
    } finally {
      fixture.cleanup();
    }
  });
});

const healthySql = [
  "purchases|0",
  "fulfillment|0",
  "notification_outbox|0",
  "email_effects|0",
  "billing_queue_idle|0",
  "",
].join("\n");

const healthyMetrics = [
  "inside_telegram_update_failed_total 4",
  "inside_telegram_delivery_api_rejected_total 0",
  "inside_telegram_community_oldest_due_seconds 0",
  "inside_telegram_activation_oldest_pending_seconds 0",
  "",
].join("\n");

/**
 * @typedef {ReturnType<typeof createFixture>} Fixture
 */
function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "inside-watchdog-"));
  const root = resolve(directory, "host");
  const bin = resolve(directory, "bin");
  const fakes = resolve(root, "fake");
  for (const path of [
    bin,
    fakes,
    resolve(root, "proc"),
    resolve(root, "etc/inside/watchdog"),
    resolve(root, "etc/inside/telegram"),
    resolve(root, "var/lib/inside/deployments"),
  ]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(
    resolve(root, "proc/meminfo"),
    "MemTotal: 4003840 kB\nMemAvailable: 1482752 kB\n",
  );
  writeFileSync(
    resolve(root, "var/lib/inside/deployments/state.json"),
    JSON.stringify({ current: { version: "v18" } }),
  );
  writeFileSync(
    resolve(root, "etc/inside/telegram/application.env"),
    "TELEGRAM_BOT_TOKEN=sales-test-token\n",
  );

  /** @param {string} name @param {string} content */
  const fake = (name, content) => writeFileSync(resolve(fakes, name), content);
  fake(
    "ps-inside-platform-production",
    "inside-platform-production-api-1\trunning\tUp 3 hours (healthy)\n",
  );
  fake(
    "ps-inside-production-logto",
    "inside-production-logto-logto-migrations-1\texited\tExited (0) 2 days ago\n",
  );
  fake(
    "platform-containers",
    "inside-platform-production-api-1\tapi\ninside-platform-production-web-1\tweb\n",
  );
  fake("sql", healthySql);
  fake("metrics", healthyMetrics);
  fake("webhook", '{"ok":true,"result":{"pending_update_count":0}}');
  fake(
    "df",
    "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 100 48 52 48% /\n",
  );
  for (const kind of ["incr", "diff", "full"]) {
    fake(
      `backup-${kind}`,
      `Result=success\nExecMainExitTimestamp=@${String(now - 3600)}\n`,
    );
  }

  writeExecutable(resolve(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(
    resolve(bin, "df"),
    '#!/usr/bin/env bash\ncat "$INSIDE_WATCHDOG_TEST_ROOT/fake/df"\n',
  );
  writeExecutable(
    resolve(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
fakes="$INSIDE_WATCHDOG_TEST_ROOT/fake"
args="$*"
project="$(sed -n 's/.*label=com.docker.compose.project=\\([^ ]*\\).*/\\1/p' <<<"$args")"
case "$1" in
  ps)
    if [[ "$args" == *"service=postgres"* ]]; then
      echo postgres-test
    elif [[ "$args" == *"--quiet"* ]]; then
      [[ -f "$fakes/ps-$project" ]] && cut -f1 "$fakes/ps-$project"
    elif [[ "$args" == *"--all"* ]]; then
      [[ -f "$fakes/ps-$project" ]] && cat "$fakes/ps-$project"
    else
      cat "$fakes/platform-containers"
    fi
    ;;
  inspect)
    shift 3
    for name in "$@"; do
      if [[ -f "$fakes/oom-$name" ]]; then echo "/$name true"; else echo "/$name false"; fi
    done
    ;;
  exec)
    cat >/dev/null
    [[ -f "$fakes/sql-fail" ]] && exit 1
    cat "$fakes/sql"
    ;;
  logs)
    name="\${*: -1}"
    [[ -f "$fakes/logs-$name" ]] && cat "$fakes/logs-$name"
    ;;
esac
exit 0
`,
  );
  writeExecutable(
    resolve(bin, "systemctl"),
    `#!/usr/bin/env bash
fakes="$INSIDE_WATCHDOG_TEST_ROOT/fake"
case "$1" in
  is-active) echo active ;;
  show)
    kind="\${2#inside-pgbackrest-backup@}"
    cat "$fakes/backup-\${kind%.service}"
    ;;
esac
`,
  );
  writeExecutable(
    resolve(bin, "curl"),
    `#!/usr/bin/env bash
fakes="$INSIDE_WATCHDOG_TEST_ROOT/fake"
args="$*"
config=""
if [[ "$args" == *"--config -"* ]]; then config="$(cat)"; fi
case "$args $config" in
  */ready*) [[ -f "$fakes/ready-fail" ]] && exit 22; exit 0 ;;
  */metrics*) cat "$fakes/metrics" ;;
  *getWebhookInfo*) cat "$fakes/webhook" ;;
  *sendMessage*)
    [[ -f "$fakes/send-fail" ]] && exit 7
    printf '%s\\n' "$args" >>"$INSIDE_WATCHDOG_TEST_ROOT/sent.log"
    ;;
esac
`,
  );

  return {
    root,
    bin,
    fake,
    /** @param {string} content */
    config: (content) =>
      writeFileSync(resolve(root, "etc/inside/watchdog/watchdog.env"), content),
    signals: () =>
      readOptional(resolve(root, "var/lib/inside/watchdog/signals.log")),
    sent: () => readOptional(resolve(root, "sent.log")),
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

/**
 * @param {Fixture} fixture
 * @param {number} epoch
 */
function runWatchdog(fixture, epoch) {
  return spawnSync("bash", [watchdog], {
    encoding: "utf8",
    env: {
      ...process.env,
      INSIDE_WATCHDOG_TEST_ROOT: fixture.root,
      INSIDE_WATCHDOG_TEST_NOW_EPOCH: String(epoch),
      PATH: `${fixture.bin}:${process.env["PATH"] ?? ""}`,
    },
  });
}

/**
 * Runs the watchdog once and returns the signals it wrote in this run.
 * @param {Fixture} fixture
 * @param {number} [epoch]
 */
function assertRun(fixture, epoch = now) {
  const before = fixture.signals();
  const result = runWatchdog(fixture, epoch);
  assert.equal(result.status, 0, result.stderr);
  return fixture.signals().slice(before.length);
}

/** @param {string} path */
function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * @param {string} path
 * @param {string} content
 */
function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}
