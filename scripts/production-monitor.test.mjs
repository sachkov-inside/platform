// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { decide, readState } from "./production-monitor.mjs";

describe("production external monitor", () => {
  it("signals after two failed runs in a row, then stays quiet until the recovery", () => {
    const failures = ["https://inside.sachkov.dev/: HTTP 502"];
    const first = decide({ consecutiveFailures: 0, alerted: false }, failures);
    assert.equal(first.message, null);

    const second = decide(first.state, failures);
    assert.match(
      second.message ?? "",
      /Отказ \(2 проверки подряд\):\n- https:\/\/inside\.sachkov\.dev\/: HTTP 502/u,
    );
    assert.deepEqual(second.state, { consecutiveFailures: 2, alerted: true });

    const third = decide(second.state, ["TLS auth.sachkov.dev: нет ответа"]);
    assert.equal(third.message, null);

    const recovered = decide(third.state, []);
    assert.match(recovered.message ?? "", /^Восстановлено/u);
    assert.deepEqual(recovered.state, {
      consecutiveFailures: 0,
      alerted: false,
    });
  });

  it("forgets a single failure that the next run does not repeat", () => {
    const first = decide({ consecutiveFailures: 0, alerted: false }, ["x"]);
    const healthy = decide(first.state, []);
    assert.equal(healthy.message, null);
    assert.equal(decide(healthy.state, ["x"]).message, null);
  });

  it("starts from a clean state when the saved one is missing or malformed", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "inside-monitor-"));
    try {
      const path = resolve(directory, "state.json");
      assert.deepEqual(readState(path), {
        consecutiveFailures: 0,
        alerted: false,
      });
      writeFileSync(path, '{"consecutiveFailures":"2","alerted":true}');
      assert.deepEqual(readState(path), {
        consecutiveFailures: 0,
        alerted: false,
      });
      writeFileSync(path, '{"consecutiveFailures":1,"alerted":false}');
      assert.deepEqual(readState(path), {
        consecutiveFailures: 1,
        alerted: false,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe("production monitor workflow", () => {
  const workflow = readFileSync(
    resolve(".github/workflows/production-monitor.yml"),
    "utf8",
  );

  it("runs on a schedule with read-only permissions and only the signal bot secrets", () => {
    assert.match(workflow, /^ {4}- cron: "\*\/10 \* \* \* \*"$/mu);
    assert.match(workflow, /^permissions: \{\}$/mu);
    assert.match(workflow, /^ {6}contents: read$/mu);
    const secrets = [
      ...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/gu),
    ].map(([, name]) => name);
    assert.deepEqual(secrets, [
      "MONITOR_TELEGRAM_BOT_TOKEN",
      "MONITOR_TELEGRAM_CHAT_ID",
    ]);
    assert.doesNotMatch(workflow, /environment:/u);
  });
});
