// @ts-check
// Local authoring targets. Every origin is loopback HTTP; there is no remote or production mode here.
export const localTargets = Object.freeze({
  editor: "http://127.0.0.1:4396",
  stand: "http://127.0.0.1:4398",
});
// Where a reader opens the result: the editor gateway serves pages itself, the stand serves them on its web port.
const readerOrigins = Object.freeze({
  editor: localTargets.editor,
  stand: "http://127.0.0.1:3000",
});

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
// Large Markdown bodies and file uploads stay within one local request budget.
const localRequestTimeoutMs = 60_000;

/**
 * @typedef {(
 *   path: string,
 *   body?: unknown,
 *   key?: string,
 *   options?: { method?: string },
 * ) => Promise<unknown>} LocalTransport
 * @typedef {keyof typeof localTargets} LocalTargetName
 */

/** @param {string} value */
export function loopbackOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !loopbackHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Authoring target must be a loopback HTTP origin: ${value}`,
    );
  }
  return url.origin;
}

/**
 * @param {string} name
 * @returns {name is LocalTargetName}
 */
function isLocalTargetName(name) {
  return Object.hasOwn(localTargets, name);
}

export function resolveLocalTarget(name = "editor") {
  if (!isLocalTargetName(name))
    throw new Error(`Unknown local authoring target: ${name}`);
  return loopbackOrigin(localTargets[name]);
}

/** @param {string} origin */
export function readerOriginFor(origin) {
  const name = Object.keys(localTargets)
    .filter(isLocalTargetName)
    .find((key) => localTargets[key] === loopbackOrigin(origin));
  return name === undefined ? loopbackOrigin(origin) : readerOrigins[name];
}

/**
 * The HTTP status a failed local request carries, or undefined for another failure.
 *
 * @param {unknown} error
 * @returns {unknown}
 */
export function failureStatus(error) {
  return error instanceof Error && "status" in error ? error.status : undefined;
}

/**
 * A field of the JSON body a failed local request carries, or undefined.
 *
 * @param {unknown} error
 * @param {string} field
 * @returns {unknown}
 */
export function failureBodyField(error, field) {
  if (!(error instanceof Error && "body" in error)) return undefined;
  const { body } = error;
  return typeof body === "object" && body !== null && field in body
    ? Reflect.get(body, field)
    : undefined;
}

// JSON bodies are sent as JSON; FormData bodies stay multipart. The gateway adds the owner credential.
/**
 * @param {string} origin
 * @returns {LocalTransport}
 */
export function localTransport(origin) {
  const base = loopbackOrigin(origin);
  return async function request(path, body, key, { method } = {}) {
    const form = body instanceof FormData;
    const response = await fetch(`${base}/__local-api${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      redirect: "error",
      headers: {
        ...(body === undefined || form
          ? {}
          : { "content-type": "application/json" }),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: form ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(localRequestTimeoutMs),
    });
    const text = await response.text();
    /** @type {unknown} */
    const result = text === "" ? null : JSON.parse(text);
    if (!response.ok)
      throw Object.assign(new Error(`${path}: ${response.status} ${text}`), {
        status: response.status,
        body: result,
      });
    return result;
  };
}
