// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  decide,
  readState,
  recordCheck,
  runChecks,
} from "./production-monitor.mjs";

describe("production external monitor", () => {
  it("checks the current Web, API and identity origins without following redirects", async (context) => {
    /** @type {string[]} */
    const requests = [];
    /** @type {string[]} */
    const certificates = [];
    /** @type {typeof fetch} */
    const fetchDouble = async (input, options) => {
      requests.push(String(input));
      assert.equal(options?.redirect, "manual");
      return Response.json({
        items: [],
        issuer: "https://auth.sachkov.dev/oidc",
      });
    };
    context.mock.method(globalThis, "fetch", fetchDouble);
    assert.deepEqual(
      await runChecks(async (host) => {
        certificates.push(host);
        return null;
      }),
      [],
    );
    assert.deepEqual(requests.sort(), [
      "https://auth.sachkov.dev/oidc/.well-known/openid-configuration",
      "https://inside.sachkov.dev/billing/cohorts",
      "https://sachkov.dev/",
    ]);
    assert.deepEqual(certificates.sort(), [
      "auth.sachkov.dev",
      "inside.sachkov.dev",
      "sachkov.dev",
    ]);
  });

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

  it("retries an undelivered confirmed failure and keeps the GitHub fallback red", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "inside-monitor-"));
    try {
      const path = resolve(directory, "state.json");
      const failures = ["https://sachkov.dev/: HTTP 502"];
      /** @type {string[]} */
      const messages = [];
      /** @param {string} message */
      const reject = async (message) => {
        messages.push(message);
        return false;
      };
      assert.equal(await recordCheck(path, failures, reject), 0);
      assert.equal(await recordCheck(path, failures, reject), 1);
      assert.equal(await recordCheck(path, failures, reject), 1);
      assert.equal(messages.length, 2);
      assert.equal(readState(path).alerted, false);
      assert.equal(await recordCheck(path, failures, async () => true), 0);
      assert.equal(readState(path).alerted, true);
      assert.equal(await recordCheck(path, failures, reject), 0);
      assert.equal(messages.length, 2);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
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

  it("retries failed recovery delivery until confirmation, then stays quiet", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "inside-monitor-"));
    try {
      const path = resolve(directory, "state.json");
      writeFileSync(path, '{"consecutiveFailures":2,"alerted":true}');
      /** @type {string[]} */
      const messages = [];
      /** @param {string} message */
      const reject = async (message) => {
        messages.push(message);
        return false;
      };
      assert.equal(await recordCheck(path, [], reject), 1);
      assert.equal(await recordCheck(path, [], reject), 1);
      assert.equal(messages.length, 2);
      assert.match(messages[1] ?? "", /Восстановлено/u);
      assert.equal(readState(path).alerted, true);
      assert.equal(await recordCheck(path, [], async () => true), 0);
      assert.equal(readState(path).alerted, false);
      assert.equal(await recordCheck(path, [], reject), 0);
      assert.equal(messages.length, 2);
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
