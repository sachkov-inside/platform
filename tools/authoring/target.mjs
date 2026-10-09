// @ts-check
// Authoring targets. Local ones are loopback HTTP behind a gateway that adds the credential; a trusted
// remote target is named here, pinned to one HTTPS base and reached only by the reviewed release (#805).
export const localTargets = Object.freeze({
  editor: "http://127.0.0.1:4396",
  stand: "http://127.0.0.1:4398",
});
// Where a reader opens the result: the editor gateway serves pages itself, the stand serves them on its web port.
const readerOrigins = Object.freeze({
  editor: localTargets.editor,
  stand: "http://127.0.0.1:3000",
});

/**
 * The production edge publishes backend `/authoring/*` under this base only; the owner's Logto
 * access token for the API resource authorizes each request, and `materials:manage` is checked by
 * Platform. Origins come from docs/runbooks/production-delivery.md and the production api.env.
 */
export const trustedTargets = Object.freeze({
  production: Object.freeze({
    id: "https://inside.sachkov.dev/authoring-api",
    reader: "https://sachkov.dev",
    environment: /** @type {const} */ ("production"),
    issuer: "https://auth.sachkov.dev/oidc",
    resource: "https://api.inside.sachkov.dev",
  }),
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
 * @typedef {keyof typeof trustedTargets} TrustedTargetName
 * @typedef {{ kind: "local"; id: string; reader: string; environment: "development" }} LocalTarget
 * @typedef {{ kind: "trusted"; name: TrustedTargetName } & (typeof trustedTargets)[TrustedTargetName]} TrustedTarget
 * @typedef {LocalTarget | TrustedTarget} AuthoringTarget
 * @typedef {() => Promise<string>} AccessToken A fresh bearer for a trusted target.
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
 * @returns {name is TrustedTargetName}
 */
function isTrustedTargetName(name) {
  return Object.hasOwn(trustedTargets, name);
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

/**
 * A local name or loopback origin, or a trusted target by name or base; anything else is refused.
 *
 * @param {string} value
 * @returns {AuthoringTarget}
 */
export function authoringTarget(value) {
  const name = Object.keys(trustedTargets)
    .filter(isTrustedTargetName)
    .find((key) => key === value || trustedTargets[key].id === value);
  if (name !== undefined)
    return { kind: "trusted", name, ...trustedTargets[name] };
  const origin = isLocalTargetName(value)
    ? resolveLocalTarget(value)
    : loopbackOrigin(value);
  return {
    kind: "local",
    id: origin,
    reader: readerOriginFor(origin),
    environment: "development",
  };
}

/** @param {TrustedTarget} target */
export const loginHint = (target) =>
  `run pnpm authoring:login --target ${target.name} --client-id CLIENT_ID`;

/**
 * A target that answers as another environment is the wrong one, whatever its address.
 *
 * @param {AuthoringTarget} target
 * @param {string} mode what the target's runtime reports
 */
export function assertTargetEnvironment(target, mode) {
  if (mode !== target.environment)
    throw new Error(
      `Target ${target.id} reports a ${mode} runtime; expected ${target.environment}`,
    );
}

/**
 * @param {string} value
 * @returns {TrustedTarget}
 */
export function trustedTarget(value) {
  const target = authoringTarget(value);
  if (target.kind !== "trusted")
    throw new Error(`${value} is a local target; it needs no owner sign-in`);
  return target;
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
  return httpTransport(
    `${loopbackOrigin(origin)}/__local-api`,
    async () => ({}),
  );
}

/**
 * The trusted transport: the pinned HTTPS base with a fresh owner bearer on every request.
 *
 * @param {TrustedTarget} target
 * @param {AccessToken} accessToken
 * @returns {LocalTransport}
 */
export function trustedTransport(target, accessToken) {
  const base = new URL(target.id);
  if (base.protocol !== "https:")
    throw new Error(`Trusted target must use HTTPS: ${target.id}`);
  return httpTransport(target.id, async () => ({
    authorization: `Bearer ${await accessToken()}`,
  }));
}

/**
 * @param {AuthoringTarget} target
 * @param {AccessToken | undefined} accessToken
 * @returns {LocalTransport}
 */
export function transportFor(target, accessToken) {
  if (target.kind === "local") return localTransport(target.id);
  if (accessToken === undefined)
    throw new Error(
      `Target ${target.name} needs the owner's session: ${loginHint(target)}`,
    );
  return trustedTransport(target, accessToken);
}

/**
 * @param {string} base
 * @param {() => Promise<Record<string, string>>} credential
 * @returns {LocalTransport}
 */
function httpTransport(base, credential) {
  return async function request(path, body, key, { method } = {}) {
    const form = body instanceof FormData;
    const response = await fetch(`${base}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      redirect: "error",
      headers: {
        ...(await credential()),
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
