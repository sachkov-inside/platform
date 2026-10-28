// @ts-check
/** Semantic fixture checks consume private responses; only closed observations leave this module. */
/** @param {string | undefined} value */
export function telegramSeedRange(value) {
  if (value === undefined || !/^(0|64|128|192)$/u.test(value))
    throw new Error("fixed Telegram seed batch required");
  const start = Number(value);
  return { start, end: start + 64 };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** @param {unknown} value */
function uuid(value) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value)
  );
}
/** @param {unknown} body */
export function accountId(body) {
  return record(body) &&
    record(body["account"]) &&
    uuid(body["account"]["accountId"])
    ? body["account"]["accountId"]
    : null;
}
/** @param {{status:number,value:unknown}} response @param {string} process @param {string} source */
export function readiness(response, process, source) {
  if (response.status !== 200 || !record(response.value)) return false;
  const body = response.value;
  if (process === "telegram") return body["status"] === "ready";
  if (process === "logto") return operationOk(response, "logto_discovery", "");
  if (process === "umami") return body["ok"] === true;
  return (
    body["status"] === "ready" &&
    body["process"] === process &&
    record(body["release"]) &&
    body["release"]["release"] === "v1" &&
    body["release"]["sourceSha"] === source &&
    record(body["schema"]) &&
    typeof body["schema"]["identity"] === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(body["schema"]["identity"]) &&
    typeof body["schema"]["migrationCount"] === "number" &&
    Number.isSafeInteger(body["schema"]["migrationCount"]) &&
    body["schema"]["migrationCount"] > 0 &&
    (process === "web"
      ? record(body["dependencies"]) && body["dependencies"]["api"] === "ready"
      : body["database"] === "reachable")
  );
}
/** @param {{status:number,value:unknown}} response @param {string} process @param {string} source */
export function readinessObservation(response, process, source) {
  const ok = readiness(response, process, source);
  let cause = ok
    ? "ready"
    : response.status === 0
      ? "transport_unavailable"
      : response.status >= 500
        ? "http_unavailable"
        : "unexpected_response";
  if (
    !ok &&
    process === "telegram" &&
    response.status === 503 &&
    record(response.value)
  ) {
    if (response.value["message"] === "Database is unavailable")
      cause = "database_unavailable";
    if (
      response.value["message"] ===
      "Telegram Membership provider is unavailable"
    )
      cause = "membership_unavailable";
  }
  return {
    ok,
    status:
      Number.isSafeInteger(response.status) &&
      response.status >= 0 &&
      response.status <= 599
        ? response.status
        : null,
    cause,
  };
}
/** @param {{status:number,value:unknown}} response @param {string} label @param {string} expected */
export function operationOk(response, label, expected) {
  const body = response.value;
  if (label === "telegram_webhook")
    return response.status === 202 && record(body) && body["accepted"] === true;
  if (label === "analytics_disabled") return response.status === 204;
  if (response.status !== 200) return false;
  if (label === "web_home" || label === "web_material")
    return (
      typeof body === "string" &&
      /<html[\s>]/iu.test(body) &&
      (label === "web_home"
        ? body.includes("Главная") &&
          body.includes("home-page") &&
          !body.includes("Не удалось загрузить продукт") &&
          !body.includes("Не удалось загрузить материалы")
        : body.match(/<h1\b[^>]*>([^<]*)<\/h1>/iu)?.[1]?.trim() === expected)
    );
  if (label === "api_account") return accountId(body) === expected;
  if (!record(body)) return false;
  if (label === "logto_discovery")
    return (
      body["issuer"] === "http://logto:3001/oidc" &&
      body["jwks_uri"] === "http://logto:3001/oidc/jwks" &&
      body["authorization_endpoint"] === "http://logto:3001/oidc/auth" &&
      body["token_endpoint"] === "http://logto:3001/oidc/token"
    );
  if (label === "api_catalog")
    return (
      Array.isArray(body["items"]) &&
      body["items"].length === 200 &&
      body["items"].every(
        (item) =>
          record(item) &&
          typeof item["slug"] === "string" &&
          item["slug"].startsWith("resource-material-") &&
          typeof item["publishedAt"] === "string" &&
          Number.isFinite(Date.parse(item["publishedAt"])),
      ) &&
      typeof body["nextCursor"] === "string" &&
      Array.isArray(body["productSlugs"]) &&
      body["productSlugs"].every((item) => typeof item === "string") &&
      Array.isArray(body["topicSlugs"]) &&
      body["topicSlugs"].every((item) => typeof item === "string")
    );
  if (label === "mcp_discovery")
    return (
      body["jsonrpc"] === "2.0" &&
      body["id"] === Number(expected) &&
      record(body["result"]) &&
      body["result"]["protocolVersion"] === "2025-03-26" &&
      record(body["result"]["serverInfo"]) &&
      body["result"]["serverInfo"]["name"] ===
        "inside-platform-material-authoring" &&
      body["result"]["serverInfo"]["version"] === "1.0.0"
    );
  return (
    label === "analytics_send" &&
    typeof body["cache"] === "string" &&
    body["cache"].length > 0 &&
    uuid(body["sessionId"]) &&
    uuid(body["visitId"])
  );
}

/** Fixed initialize response only; no stream aggregation or partial-message acceptance.
 * @param {string} text @param {string | undefined} contentType @returns {unknown} */
export function mcpInitializeResponse(text, contentType) {
  if (Buffer.byteLength(text) > 1_048_576) return null;
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  let encoded = text;
  if (type === "text/event-stream") {
    const frame = /^event: message\r?\ndata: ([^\r\n]+)\r?\n\r?\n$/u.exec(text);
    if (!frame?.[1]) return null;
    encoded = frame[1];
  } else if (type !== "application/json") return null;
  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

/** Closed raw Web cohort, never the original exposition or request identity.
 * @param {unknown} body @param {string} source
 */
export function webHttpObservation(body, source) {
  if (
    typeof body !== "string" ||
    Buffer.byteLength(body) > 1_048_576 ||
    body.includes("private-http-sentinel") ||
    !/^[a-f0-9]{40}$/u.test(source)
  )
    return null;
  const lines = body.split("\n");
  const epochs = lines.filter((line) =>
    line.startsWith("inside_web_http_process_start_time_seconds{"),
  );
  if (epochs.length !== 1) return null;
  const base = epochs[0]?.match(
    new RegExp(
      '^inside_web_http_process_start_time_seconds\\{(service="platform-web",environment="(?:test|isolated-pilot|production)",source_sha="' +
        source +
        '")\\} ',
    ),
  )?.[1];
  if (base === undefined) return null;
  /** @param {string} name @param {string} [labels] */
  function sample(name, labels = "") {
    const prefix = name + "{" + base + labels + "} ";
    const matches = lines.filter((line) => line.startsWith(prefix));
    if (matches.length !== 1) return null;
    const text = matches[0]?.slice(prefix.length) ?? "";
    if (text.length > 32 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(text))
      return null;
    const value = Number(text);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const positive_count = sample(
    "inside_web_http_requests_total",
    ',route="/_health/live",method="GET",code="200",outcome="completed"',
  );
  const not_found_count = sample(
    "inside_web_http_requests_total",
    ',route="_unmatched",method="GET",code="404",outcome="completed"',
  );
  const process_start_seconds = sample(
    "inside_web_http_process_start_time_seconds",
  );
  const observed_at_seconds = sample("inside_web_http_observed_at_seconds");
  const value = {
    ok: true,
    positive_count,
    not_found_count,
    process_start_seconds,
    observed_at_seconds,
  };
  return webHttpExpected(value) ? value : null;
}
/** @typedef {{ok:true, positive_count:number, not_found_count:number, process_start_seconds:number, observed_at_seconds:number}} WebHttpWitness */
/** @param {unknown} value @returns {value is WebHttpWitness} */
export function webHttpExpected(value) {
  return (
    record(value) &&
    value["ok"] === true &&
    Object.keys(value).sort().join(",") ===
      "not_found_count,observed_at_seconds,ok,positive_count,process_start_seconds" &&
    ["positive_count", "not_found_count"].every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isSafeInteger(value[key]) &&
        value[key] >= 1,
    ) &&
    ["process_start_seconds", "observed_at_seconds"].every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        value[key] > 0 &&
        value[key] < 1e12,
    ) &&
    Number(value["process_start_seconds"]) <=
      Number(value["observed_at_seconds"])
  );
}

/** Closed synthetic cohorts, not application source SHAs. The unchanged privacy
 * contract already admits this version shape and the fixed /pilot route.
 * @param {number} phase
 */
export function probeVersion(phase) {
  if (!Number.isInteger(phase) || phase < 0 || phase > 13)
    throw new Error("fixed probe cohort required");
  return "1566".repeat(9) + phase.toString(16).padStart(4, "0");
}

/** Native HTTP stats are direct; the MCP tool's `current` wrapper is different.
 * @param {unknown} value
 */
export function nativeStats(value) {
  return (
    record(value) &&
    Number.isSafeInteger(value["pageviews"]) &&
    Number(value["pageviews"]) >= 1
  );
}

/** The original predicate remains the only positive verdict. Diagnostic branches share its evaluation cut.
 * Known fixed exporter labels are removed; unexpected native labels survive for strict refusal.
 * `job` distinguishes union branches because vector `or` ignores metric names.
 * @param {string} predicate
 */
export function sourceCacheQuery(predicate) {
  const selector =
    '{job="platform-owner-cache",instance="production-host",source=~"postgresql|caddy"}';
  const available = "inside_production_source_available" + selector;
  const observed = "inside_production_source_observed_at_seconds" + selector;
  /** @param {string} expression */
  const clean = (expression) =>
    "label_del(" + expression + ',"__name__","job","instance")';
  return [
    "label_set((" +
      predicate +
      '),"source","cohort","job","source_cache_ready")',
    'label_set(time(),"source","cohort","job","source_cache_evaluation")',
    "label_set(" + clean(available) + ',"job","source_cache_available")',
    "label_set(" + clean(observed) + ',"job","source_cache_observed")',
    "label_set(" + clean("time()-" + observed) + ',"job","source_cache_age")',
  ].join(" or ");
}

/** @typedef {{available:number|null,observed_at_seconds:number|null,age_seconds:number|null}} CacheSource */
/** @typedef {{reason:string,ready:number|null,evaluation_seconds:number|null,sources:{postgresql:CacheSource,caddy:CacheSource}}} SourceCacheDiagnostic */
/** One bounded native response, never raw labels or values outside the closed numeric domain.
 * Missing ready is unknown, not zero. Diagnostics never manufacture a positive verdict.
 * @param {{status:number,value:unknown}} response
 * @returns {{ok:boolean,diagnostic:SourceCacheDiagnostic}}
 */
export function sourceCacheObservation(response) {
  /** @type {SourceCacheDiagnostic} */
  const diagnostic = {
    reason: "schema",
    ready: null,
    evaluation_seconds: null,
    sources: {
      postgresql: {
        available: null,
        observed_at_seconds: null,
        age_seconds: null,
      },
      caddy: { available: null, observed_at_seconds: null, age_seconds: null },
    },
  };
  /** @param {string} reason */
  const refuse = (reason) => {
    diagnostic.reason = reason;
    return { ok: false, diagnostic };
  };
  if (response.status !== 200) return refuse("http");
  const raw = response.value;
  if (
    !record(raw) ||
    raw["status"] !== "success" ||
    !record(raw["data"]) ||
    raw["data"]["resultType"] !== "vector" ||
    !Array.isArray(raw["data"]["result"])
  )
    return refuse("schema");
  const rows = raw["data"]["result"];
  if (rows.length > 8) return refuse("row_count");
  const seen = new Set();
  /** @type {Record<string,number>} */
  const numbers = {};
  let cut = null;
  for (const row of rows) {
    if (
      !record(row) ||
      Object.keys(row).length !== 2 ||
      !record(row["metric"]) ||
      !Array.isArray(row["value"]) ||
      row["value"].length !== 2
    )
      return refuse("schema");
    const labels = row["metric"];
    /** @type {unknown[]} */ const pair = row["value"];
    if (
      Object.keys(labels).length !== 2 ||
      Object.keys(labels).some((key) => key !== "job" && key !== "source") ||
      typeof labels["job"] !== "string" ||
      typeof labels["source"] !== "string"
    )
      return refuse("labels");
    const job = labels["job"],
      source = labels["source"];
    const cohort = source === "cohort";
    if (
      !(cohort
        ? ["source_cache_ready", "source_cache_evaluation"].includes(job)
        : ["postgresql", "caddy"].includes(source) &&
          [
            "source_cache_available",
            "source_cache_observed",
            "source_cache_age",
          ].includes(job))
    )
      return refuse("labels");
    const timestamp = pair[0],
      text = pair[1];
    if (
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      timestamp >= Number.MAX_SAFE_INTEGER ||
      typeof text !== "string" ||
      !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text)
    )
      return refuse("numeric");
    const number = Number(text);
    if (
      !Number.isFinite(number) ||
      Math.abs(number) >= Number.MAX_SAFE_INTEGER ||
      (job === "source_cache_ready" &&
        (!Number.isSafeInteger(number) || number < 0 || number > 2)) ||
      (job === "source_cache_available" && number !== 0 && number !== 1) ||
      (job === "source_cache_observed" && number <= 0)
    )
      return refuse("numeric");
    if (cut !== null && cut !== timestamp) return refuse("evaluation");
    cut = timestamp;
    const identity = source + ":" + job;
    if (seen.has(identity)) return refuse("duplicate");
    seen.add(identity);
    numbers[identity] = number;
  }
  if (cut === null || numbers["cohort:source_cache_evaluation"] !== cut)
    return refuse("evaluation");
  diagnostic.evaluation_seconds = cut;
  diagnostic.ready = numbers["cohort:source_cache_ready"] ?? null;
  for (const source of /** @type {const} */ (["postgresql", "caddy"])) {
    diagnostic.sources[source] = {
      available: numbers[source + ":source_cache_available"] ?? null,
      observed_at_seconds: numbers[source + ":source_cache_observed"] ?? null,
      age_seconds: numbers[source + ":source_cache_age"] ?? null,
    };
  }
  const sources = Object.values(diagnostic.sources);
  if (
    sources.some((value) =>
      Object.values(value).some((number) => number === null),
    )
  )
    return refuse("missing");
  if (diagnostic.ready === 2) {
    diagnostic.reason = "ready";
    return { ok: true, diagnostic };
  }
  if (sources.some((value) => value.available !== 1))
    return refuse("unavailable");
  if (
    sources.some((value) => value.age_seconds !== null && value.age_seconds < 0)
  )
    return refuse("future");
  if (
    sources.some(
      (value) => value.age_seconds !== null && value.age_seconds > 10,
    )
  )
    return refuse("stale");
  return refuse(diagnostic.ready === null ? "ready_missing" : "ready_count");
}

/** One failure-only native query; the range applies to the original stored selector, not a subquery. */
export function sourceCacheSampleQuery() {
  const selector =
    'inside_production_source_observed_at_seconds{job="platform-owner-cache",instance="production-host",source=~"postgresql|caddy"}[30s]';
  return [
    ["last_over_time", "source_cache_sample_value"],
    ["tlast_over_time", "source_cache_sample_time"],
  ]
    .map(
      ([rollup, branch]) =>
        "label_set(label_del(" +
        rollup +
        "(" +
        selector +
        '),"__name__","job","instance"),"job","' +
        branch +
        '")',
    )
    .join(" or ");
}

/** @typedef {{sample_value_seconds:number|null,sample_time_seconds:number|null,sample_age_seconds:number|null}} CacheSample */
/** @typedef {{state:"observed"|"unavailable",reason:"observed"|"evaluation"|"transport"|"http"|"schema"|"rows"|"labels"|"numeric"|"duplicate"|"missing",status:number|null,evaluation_seconds:number|null,sources:{postgresql:CacheSample,caddy:CacheSample}}} SourceCacheSampleDiagnostic */
/** Raw sample time is the VALUE of tlast_over_time, never the vector evaluation timestamp.
 * @param {{status:number,value:unknown}} response
 * @param {unknown} cut
 * @returns {SourceCacheSampleDiagnostic}
 */
export function sourceCacheSampleObservation(response, cut) {
  /** @type {SourceCacheSampleDiagnostic} */
  const diagnostic = {
    state: "unavailable",
    reason: "evaluation",
    status:
      Number.isSafeInteger(response.status) &&
      (response.status === 0 ||
        (response.status >= 100 && response.status <= 599))
        ? response.status
        : null,
    evaluation_seconds:
      typeof cut === "number" &&
      Number.isFinite(cut) &&
      cut > 0 &&
      cut < Number.MAX_SAFE_INTEGER
        ? cut
        : null,
    sources: {
      postgresql: {
        sample_value_seconds: null,
        sample_time_seconds: null,
        sample_age_seconds: null,
      },
      caddy: {
        sample_value_seconds: null,
        sample_time_seconds: null,
        sample_age_seconds: null,
      },
    },
  };
  /** @param {SourceCacheSampleDiagnostic['reason']} reason */
  const refuse = (reason) => {
    diagnostic.reason = reason;
    return diagnostic;
  };
  if (diagnostic.evaluation_seconds === null) return diagnostic;
  const evaluation = diagnostic.evaluation_seconds;
  if (response.status !== 200)
    return refuse(response.status === 0 ? "transport" : "http");
  const raw = response.value;
  if (
    !record(raw) ||
    raw["status"] !== "success" ||
    Object.keys(raw).some(
      (key) => !["status", "data", "stats"].includes(key),
    ) ||
    !record(raw["data"]) ||
    Object.keys(raw["data"]).length !== 2 ||
    raw["data"]["resultType"] !== "vector" ||
    !Array.isArray(raw["data"]["result"])
  )
    return refuse("schema");
  // v1.154.0 emits these fixed metadata fields; none is copied into the public diagnostic.
  const stats = raw["stats"];
  if (
    stats !== undefined &&
    (!record(stats) ||
      Object.keys(stats).length !== 2 ||
      typeof stats["seriesFetched"] !== "string" ||
      !/^(?:0|[1-9]\d{0,15})$/u.test(stats["seriesFetched"]) ||
      !Number.isSafeInteger(Number(stats["seriesFetched"])) ||
      typeof stats["executionTimeMsec"] !== "number" ||
      !Number.isSafeInteger(stats["executionTimeMsec"]) ||
      stats["executionTimeMsec"] < 0)
  )
    return refuse("schema");
  const rows = raw["data"]["result"];
  if (rows.length > 4) return refuse("rows");
  /** @type {Record<string,number>} */ const values = {};
  for (const row of rows) {
    if (
      !record(row) ||
      Object.keys(row).length !== 2 ||
      !record(row["metric"]) ||
      !Array.isArray(row["value"]) ||
      row["value"].length !== 2
    )
      return refuse("schema");
    const labels = row["metric"];
    if (
      Object.keys(labels).length !== 2 ||
      Object.keys(labels).some((key) => key !== "job" && key !== "source") ||
      typeof labels["source"] !== "string" ||
      !["postgresql", "caddy"].includes(labels["source"]) ||
      typeof labels["job"] !== "string" ||
      !["source_cache_sample_value", "source_cache_sample_time"].includes(
        labels["job"],
      )
    )
      return refuse("labels");
    /** @type {unknown[]} */ const pair = row["value"];
    if (pair[0] !== evaluation) return refuse("evaluation");
    const text = pair[1];
    if (
      typeof text !== "string" ||
      text.length > 64 ||
      !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text)
    )
      return refuse("numeric");
    const value = Number(text);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      value >= Number.MAX_SAFE_INTEGER
    )
      return refuse("numeric");
    const identity = labels["source"] + ":" + labels["job"];
    if (identity in values) return refuse("duplicate");
    values[identity] = value;
  }
  for (const source of /** @type {const} */ (["postgresql", "caddy"])) {
    const value = values[source + ":source_cache_sample_value"];
    const timestamp = values[source + ":source_cache_sample_time"];
    if (value === undefined || timestamp === undefined)
      return refuse("missing");
    if (
      timestamp > evaluation ||
      timestamp < evaluation - 30 ||
      value > timestamp
    )
      return refuse("numeric");
  }
  for (const source of /** @type {const} */ (["postgresql", "caddy"])) {
    const value = values[source + ":source_cache_sample_value"];
    const timestamp = values[source + ":source_cache_sample_time"];
    if (value !== undefined && timestamp !== undefined)
      diagnostic.sources[source] = {
        sample_value_seconds: value,
        sample_time_seconds: timestamp,
        sample_age_seconds: evaluation - timestamp,
      };
  }
  diagnostic.state = "observed";
  diagnostic.reason = "observed";
  return diagnostic;
}
