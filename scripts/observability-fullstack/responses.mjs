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
