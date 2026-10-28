// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sourceCacheObservation,
  sourceCacheQuery,
  probeVersion,
  nativeStats,
  operationOk,
  mcpInitializeResponse,
  readiness,
  readinessObservation,
  telegramSeedRange,
  webHttpObservation,
  webHttpExpected,
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

test("MCP initialize decodes only one complete bounded JSON or SSE message", () => {
  const body = {
    jsonrpc: "2.0",
    id: 5,
    result: {
      protocolVersion: "2025-03-26",
      serverInfo: {
        name: "inside-platform-material-authoring",
        version: "1.0.0",
      },
    },
  };
  const data = JSON.stringify(body);
  const frame = `event: message\ndata: ${data}\n\n`;
  for (const [text, type] of /** @type {[string, string][]} */ ([
    [data, "application/json"],
    [frame, "text/event-stream"],
    [frame.replaceAll("\n", "\r\n"), "text/event-stream; charset=utf-8"],
  ])) {
    const value = mcpInitializeResponse(text, type);
    assert.deepEqual(value, body);
    assert.equal(
      operationOk({ status: 200, value }, "mcp_discovery", "5"),
      true,
    );
    assert.equal(
      operationOk({ status: 200, value }, "mcp_discovery", "6"),
      false,
    );
  }
  for (const text of [
    "",
    frame + frame,
    frame + "trailing",
    frame.trimEnd(),
    frame.replace("message", "other"),
    frame.replace("data: ", "id: 1\ndata: "),
    "data: " + data + "\n\n",
    frame.replace(data, "not-json"),
    frame.replace(data, data + "\ndata: {}"),
    "x".repeat(1_048_577),
  ])
    assert.equal(mcpInitializeResponse(text, "text/event-stream"), null);
  assert.equal(mcpInitializeResponse(frame, "application/json"), null);
  assert.equal(mcpInitializeResponse(data, "text/plain"), null);
});

test("Web witness admits only current bounded raw GET counters and a complete process cohort", () => {
  const base =
    'service="platform-web",environment="isolated-pilot",source_sha="' +
    "7".repeat(40) +
    '"';
  const rows = [
    `inside_web_http_process_start_time_seconds{${base}} 100`,
    `inside_web_http_observed_at_seconds{${base}} 200.125`,
    `inside_web_http_requests_total{${base},route="/_health/live",method="GET",code="200",outcome="completed"} 42`,
    `inside_web_http_requests_total{${base},route="_unmatched",method="GET",code="404",outcome="completed"} 43`,
  ];
  const expected = {
    ok: true,
    positive_count: 42,
    not_found_count: 43,
    process_start_seconds: 100,
    observed_at_seconds: 200.125,
  };
  const body = rows.join("\n") + "\n";
  assert.deepEqual(webHttpObservation(body, "7".repeat(40)), expected);
  for (const invalid of [
    body + rows[0] + "\n",
    body + rows[3] + "\n",
    rows.slice(1).join("\n"),
    body.replace('code="404"', 'code="500"'),
    body.replace('method="GET"', 'method="POST"'),
    body.replace('outcome="completed"', 'outcome="aborted"'),
    body.replace("200.125", "NaN"),
    body.replace("200.125", "99"),
    body.replace("} 43", "} 0"),
    body.replace("} 43", "} 1.5"),
    body.replace("} 43", "} 9007199254740992"),
    body + "private-http-sentinel",
    "x".repeat(1_048_577),
  ])
    assert.equal(webHttpObservation(invalid, "7".repeat(40)), null);
  assert.equal(webHttpObservation(body, "8".repeat(40)), null);
  assert.equal(webHttpObservation(body, '"'), null);
  for (const invalid of [
    { ...expected, positive_count: true },
    { ...expected, not_found_count: NaN },
    { ...expected, observed_at_seconds: Infinity },
    { ...expected, process_start_seconds: 201 },
    { ...expected, private: "sentinel" },
    { ok: true },
  ])
    assert.equal(webHttpExpected(invalid), false);
});

test("synthetic metric cohorts stay disjoint inside the existing privacy contract", () => {
  const versions = Array.from({ length: 14 }, (_, phase) =>
    probeVersion(phase),
  );
  assert.equal(new Set(versions).size, 14);
  assert.ok(versions.every((version) => /^[a-f0-9]{40}$/u.test(version)));
  for (const phase of [-1, 14, 1.5, NaN, Infinity])
    assert.throws(() => probeVersion(phase));
});
test("native stats require a stored positive integral count and reject the MCP wrapper", () => {
  assert.equal(nativeStats({ pageviews: 1 }), true);
  for (const value of [
    null,
    {},
    { current: { pageviews: 1 } },
    { pageviews: 0 },
    { pageviews: -1 },
    { pageviews: 1.5 },
    { pageviews: "1" },
    { pageviews: true },
    { pageviews: NaN },
    { pageviews: Infinity },
  ])
    assert.equal(nativeStats(value), false);
});

/** Closed vector fixture uses the eight native VM rows witnessed by the pinned control. */
function cacheVector() {
  return {
    status: "success",
    data: {
      resultType: "vector",
      result: [
        {
          metric: { job: "source_cache_ready", source: "cohort" },
          value: [1000, "2"],
        },
        {
          metric: { job: "source_cache_evaluation", source: "cohort" },
          value: [1000, "1000"],
        },
        ...["postgresql", "caddy"].flatMap((source) => [
          {
            metric: { job: "source_cache_available", source },
            value: [1000, "1"],
          },
          {
            metric: { job: "source_cache_observed", source },
            value: [1000, "995"],
          },
          { metric: { job: "source_cache_age", source }, value: [1000, "5"] },
        ]),
      ],
    },
  };
}
/** @param {ReturnType<typeof cacheVector>} raw @param {number} index */
function cacheRow(raw, index) {
  const row = raw.data.result[index];
  assert.ok(row);
  return row;
}
test("source-cache projection keeps the original native predicate as the sole positive verdict", () => {
  const raw = cacheVector();
  const healthy = sourceCacheObservation({ status: 200, value: raw });
  assert.equal(healthy.ok, true);
  assert.deepEqual(healthy.diagnostic, {
    reason: "ready",
    ready: 2,
    evaluation_seconds: 1000,
    sources: {
      postgresql: { available: 1, observed_at_seconds: 995, age_seconds: 5 },
      caddy: { available: 1, observed_at_seconds: 995, age_seconds: 5 },
    },
  });
  cacheRow(raw, 0).value[1] = "1";
  assert.equal(sourceCacheObservation({ status: 200, value: raw }).ok, false);
  raw.data.result.shift();
  const absent = sourceCacheObservation({ status: 200, value: raw });
  assert.equal(absent.ok, false);
  assert.equal(absent.diagnostic.ready, null);
  assert.equal(absent.diagnostic.reason, "ready_missing");
  assert.ok(
    sourceCacheQuery("count(vector(7))").startsWith(
      'label_set((count(vector(7))),"source","cohort","job","source_cache_ready") or ',
    ),
  );
});

test("source-cache diagnostics distinguish native future, stale, unavailable and absent series without zero substitution", () => {
  for (const [mode, field, number] of [
    ["future", "source_cache_age", "-0.25"],
    ["stale", "source_cache_age", "10.25"],
    ["unavailable", "source_cache_available", "0"],
  ]) {
    const raw = cacheVector();
    raw.data.result.shift();
    const row = raw.data.result.find(
      (value) =>
        value.metric.source === "postgresql" && value.metric.job === field,
    );
    assert.ok(row);
    row.value[1] = String(number);
    const result = sourceCacheObservation({ status: 200, value: raw });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.reason, mode);
    assert.equal(result.diagnostic.ready, null);
  }
  const missing = cacheVector();
  missing.data.result.splice(2, 3);
  const result = sourceCacheObservation({ status: 200, value: missing });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.reason, "missing");
  assert.deepEqual(result.diagnostic.sources.postgresql, {
    available: null,
    observed_at_seconds: null,
    age_seconds: null,
  });
});

test("source-cache observation refuses private, duplicate, malformed and nonfinite native rows with only closed output", () => {
  const sentinel = "private-sentinel";
  /** @type {unknown[]} */
  const cases = [
    null,
    {},
    { status: "success", data: { resultType: "scalar", result: [] } },
  ];
  for (const label of ["extra", "cache_field", "cohort", "__name__"]) {
    const raw = cacheVector();
    Object.assign(cacheRow(raw, 2).metric, { [label]: sentinel });
    cases.push(raw);
  }
  for (const text of [
    "NaN",
    "Infinity",
    "",
    " ",
    "0x10",
    "9007199254740992",
    sentinel,
  ]) {
    const raw = cacheVector();
    cacheRow(raw, 2).value[1] = text;
    cases.push(raw);
  }
  for (const label of ["source", "job"]) {
    const raw = cacheVector();
    Object.assign(cacheRow(raw, 2).metric, { [label]: sentinel });
    cases.push(raw);
  }
  const duplicate = cacheVector();
  duplicate.data.result.splice(7, 1, cacheRow(duplicate, 2));
  cases.push(duplicate);
  const conflicting = cacheVector();
  conflicting.data.result.splice(
    7,
    1,
    structuredClone(cacheRow(conflicting, 2)),
  );
  cacheRow(conflicting, 7).value[1] = "0";
  cases.push(conflicting);
  const clock = cacheVector();
  cacheRow(clock, 2).value[0] = 1001;
  cases.push(clock);
  const badTime = cacheVector();
  cacheRow(badTime, 2).value[0] = NaN;
  cases.push(badTime);
  const wrongEvaluation = cacheVector();
  cacheRow(wrongEvaluation, 1).value[1] = "999";
  cases.push(wrongEvaluation);
  const extraRow = cacheVector();
  extraRow.data.result.push(cacheRow(extraRow, 2));
  cases.push(extraRow);
  for (const raw of cases) {
    const result = sourceCacheObservation({ status: 200, value: raw });
    assert.equal(result.ok, false);
    assert.ok(
      [
        "schema",
        "labels",
        "numeric",
        "duplicate",
        "evaluation",
        "row_count",
      ].includes(result.diagnostic.reason),
    );
    assert.equal(JSON.stringify(result).includes(sentinel), false);
  }
  assert.equal(
    sourceCacheObservation({ status: 503, value: sentinel }).diagnostic.reason,
    "http",
  );
});
