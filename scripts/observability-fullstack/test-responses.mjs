// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  operationOk,
  readiness,
  readinessObservation,
  telegramSeedRange,
} from "./responses.mjs";

test("Telegram seed admits only the four complete disjoint corpus batches", () => {
  assert.deepEqual(["0", "64", "128", "192"].map(telegramSeedRange), [
    { start: 0, end: 64 },
    { start: 64, end: 128 },
    { start: 128, end: 192 },
    { start: 192, end: 256 },
  ]);
  for (const value of [
    undefined,
    "",
    "-1",
    "1",
    "63",
    "256",
    "0.0",
    " 0",
    "00",
  ])
    assert.throws(() => telegramSeedRange(value));
});

test("readiness requires the current source, dependencies and body, including Umami heartbeat", () => {
  const source = "a".repeat(40);
  assert.deepEqual(
    readinessObservation(
      {
        status: 503,
        value: { message: "Telegram Membership provider is unavailable" },
      },
      "telegram",
      source,
    ),
    { ok: false, status: 503, cause: "membership_unavailable" },
  );
  assert.deepEqual(
    readinessObservation(
      { status: 503, value: { message: "Database is unavailable" } },
      "telegram",
      source,
    ),
    { ok: false, status: 503, cause: "database_unavailable" },
  );
  const unknown = readinessObservation(
    { status: 503, value: { message: "private-sentinel" } },
    "telegram",
    source,
  );
  assert.equal(unknown.cause, "http_unavailable");
  assert.equal(JSON.stringify(unknown).includes("private-sentinel"), false);
  const body = {
    status: "ready",
    process: "api",
    release: { release: "v1", sourceSha: source },
    schema: { identity: "sha256:" + "b".repeat(64), migrationCount: 1 },
    database: "reachable",
  };
  assert.equal(readiness({ status: 200, value: body }, "api", source), true);
  for (const value of [
    {},
    { ...body, status: "unavailable" },
    { ...body, release: { release: "v1", sourceSha: "c".repeat(40) } },
    { ...body, database: "unreachable" },
  ])
    assert.equal(readiness({ status: 200, value }, "api", source), false);
  assert.equal(
    readiness(
      {
        status: 200,
        value: { ...body, process: "web", dependencies: { api: "ready" } },
      },
      "web",
      source,
    ),
    true,
  );
  assert.equal(
    readiness(
      {
        status: 200,
        value: { ...body, process: "web", dependencies: { api: "down" } },
      },
      "web",
      source,
    ),
    false,
  );
  assert.equal(
    readiness({ status: 200, value: { ok: true } }, "umami", source),
    true,
  );
  assert.equal(readiness({ status: 200, value: {} }, "umami", source), false);
});
test("successful HTTP envelopes cannot replace application facts or expected Account/MCP identity", () => {
  const id = "00000000-0000-4000-8000-000000001566";
  const positives = [
    {
      label: "web_home",
      value: '<html><div class="home-page">Главная</div></html>',
      expected: "",
    },
    {
      label: "web_material",
      value: "<html><h1>Synthetic 2</h1></html>",
      expected: "Synthetic 2",
    },
    {
      label: "api_account",
      value: { account: { accountId: id } },
      expected: id,
    },
    {
      label: "api_catalog",
      value: {
        items: Array.from({ length: 200 }, () => ({
          slug: "resource-material-1",
          publishedAt: "2026-10-24T10:00:00Z",
        })),
        productSlugs: [],
        topicSlugs: [],
        nextCursor: "opaque",
      },
      expected: "",
    },
    {
      label: "mcp_discovery",
      value: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-03-26",
          serverInfo: {
            name: "inside-platform-material-authoring",
            version: "1.0.0",
          },
        },
      },
      expected: "1",
    },
    {
      label: "analytics_send",
      value: { cache: "opaque", sessionId: id, visitId: id },
      expected: "",
    },
  ];
  for (const row of positives) {
    assert.equal(
      operationOk({ status: 200, value: row.value }, row.label, row.expected),
      true,
      row.label,
    );
    for (const value of [{}, null, "", { code: "dependency_unavailable" }])
      assert.equal(
        operationOk({ status: 200, value }, row.label, row.expected),
        false,
        row.label,
      );
  }
  assert.equal(
    operationOk(
      { status: 200, value: { account: { accountId: id } } },
      "api_account",
      "00000000-0000-4000-8000-000000001567",
    ),
    false,
  );
  assert.equal(
    operationOk(
      { status: 200, value: positives[4]?.value },
      "mcp_discovery",
      "2",
    ),
    false,
  );
});

test("material and home HTML cannot substitute an error shell or a different Material", () => {
  assert.equal(
    operationOk(
      { status: 200, value: "<html><h1>Synthetic 3</h1></html>" },
      "web_material",
      "Synthetic 2",
    ),
    false,
  );
  assert.equal(
    operationOk(
      {
        status: 200,
        value:
          '<html><div class="home-page">Главная. Не удалось загрузить материалы.</div></html>',
      },
      "web_home",
      "",
    ),
    false,
  );
});

test("native Telegram and Logto checks require their actual semantic responses", () => {
  assert.equal(
    readiness({ status: 200, value: { status: "ready" } }, "telegram", ""),
    true,
  );
  assert.equal(
    readiness({ status: 200, value: { status: "ok" } }, "telegram", ""),
    false,
  );
  const discovery = {
    issuer: "http://logto:3001/oidc",
    jwks_uri: "http://logto:3001/oidc/jwks",
    authorization_endpoint: "http://logto:3001/oidc/auth",
    token_endpoint: "http://logto:3001/oidc/token",
  };
  assert.equal(
    operationOk({ status: 200, value: discovery }, "logto_discovery", ""),
    true,
  );
  assert.equal(readiness({ status: 200, value: discovery }, "logto", ""), true);
  assert.equal(
    operationOk(
      {
        status: 200,
        value: { ...discovery, issuer: "https://foreign.invalid" },
      },
      "logto_discovery",
      "",
    ),
    false,
  );
  assert.equal(
    operationOk(
      { status: 202, value: { accepted: true } },
      "telegram_webhook",
      "",
    ),
    true,
  );
  assert.equal(
    operationOk({ status: 202, value: {} }, "telegram_webhook", ""),
    false,
  );
  assert.equal(
    operationOk(
      { status: 200, value: { accepted: true } },
      "telegram_webhook",
      "",
    ),
    false,
  );
});
