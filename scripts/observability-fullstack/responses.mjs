// @ts-check
/** Semantic fixture checks consume private responses; only booleans leave this module. */
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
/** @param {{status:number,value:unknown}} response @param {string} label @param {string} expected */
export function operationOk(response, label, expected) {
  const body = response.value;
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
