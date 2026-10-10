// @ts-check

/** @typedef {{event: string, [key: string]: unknown}} Record */
/** @typedef {{[key: string]: unknown}} Metadata */

/** One clock reading owns each timestamp and elapsed value; counters belong to one SDK boundary.
 * @param {string} boundary
 * @param {(record: Record) => void} emit
 * @param {() => number} now
 */
function callReceipts(boundary, emit, now) {
  let sequence = 0;
  let active = 0;
  /** @param {Metadata} details */
  return (details) => {
    const started = now();
    const call = ++sequence;
    emit({
      event: `${boundary}-start`,
      ...details,
      call,
      activeLogicalCalls: ++active,
      monotonicMs: started,
    });
    /** @param {string} outcome @param {Metadata} [result] */
    return (outcome, result = {}) => {
      const ended = now();
      emit({
        event: `${boundary}-${outcome}`,
        ...details,
        ...result,
        call,
        activeLogicalCalls: --active,
        monotonicMs: ended,
        elapsedMs: ended - started,
      });
    };
  };
}

/** @param {unknown} options @param {string} key */
function option(options, key) {
  return options !== null && typeof options === "object" && key in options
    ? options[key]
    : undefined;
}

/** @param {unknown} options */
function platform(options) {
  const value = option(options, "platform");
  return value === "linux/amd64" || value === "linux/arm64"
    ? value
    : "daemon-default-or-omitted";
}
/**
 * Observe the SDK boundary without replacing its promise or error. No arbitrary error text is logged.
 * @template {{string: string}} Image
 * @template Options
 * @template Result
 * @param {{pull(image: Image, options?: Options): Promise<Result>}} client
 * @param {(record: Record) => void} emit
 * @param {() => number} [now]
 */
export function observePull(client, emit, now = () => performance.now()) {
  const original = client.pull;
  const begin = callReceipts("pull", emit, now);
  client.pull = function (image, options) {
    const force = option(options, "force");
    const finish = begin({
      image: safeImage(image.string),
      force: typeof force === "boolean" ? force : "unspecified",
      platform: platform(options),
    });
    let promise;
    try {
      promise = original.call(this, image, options);
    } catch (error) {
      finish("failed");
      throw error;
    }
    void promise.then(
      () => finish("complete"),
      () => finish("failed"),
    );
    return promise;
  };
  return () => {
    client.pull = original;
  };
}

/** Auth lookup remains the SDK's lookup; only its presence is observed.
 * @template Result
 * @param {{getAuthConfig(registry: string): Promise<Result>}} lookup
 * @param {(record: Record) => void} emit
 * @param {() => number} [now]
 */
export function observeAuth(lookup, emit, now = () => performance.now()) {
  const original = lookup.getAuthConfig;
  const begin = callReceipts("auth", emit, now);
  lookup.getAuthConfig = function (registry) {
    const finish = begin({
      registry:
        registry === "public.ecr.aws" || registry === "ghcr.io"
          ? registry
          : "omitted",
    });
    const promise = original.call(this, registry);
    void promise.then(
      (result) =>
        finish("resolved", {
          present: result !== undefined && result !== null,
        }),
      () => finish("failed"),
    );
    return promise;
  };
  return () => {
    lookup.getAuthConfig = original;
  };
}

/** Observe the SDK's own cache check; never add an inspection.
 * @template {{string: string}} Image
 * @param {{exists(image: Image): Promise<boolean>}} client
 * @param {(record: Record) => void} emit
 * @param {() => number} [now]
 */
export function observeExists(client, emit, now = () => performance.now()) {
  const original = client.exists;
  const begin = callReceipts("exists", emit, now);
  client.exists = function (image) {
    const finish = begin({ image: safeImage(image.string) });
    const promise = original.call(this, image);
    void promise.then(
      (exists) => finish("result", { exists }),
      () => finish("failed"),
    );
    return promise;
  };
  return () => {
    client.exists = original;
  };
}

/** Actual Docker Engine pull call, not the daemon's internal registry HTTP requests.
 * @template Result
 * @param {{pull(image: string, options?: {authconfig?: unknown, platform?: unknown}): Promise<Result>}} transport
 * @param {(record: Record) => void} emit
 * @param {() => number} [now]
 */
export function observeRequest(transport, emit, now = () => performance.now()) {
  const original = transport.pull;
  const begin = callReceipts("request", emit, now);
  transport.pull = function (image, options) {
    const auth = option(options, "authconfig");
    const finish = begin({
      image: safeImage(image),
      endpoint: "docker-engine-image-create",
      authConfigPresent: auth !== undefined && auth !== null,
      platform: platform(options),
    });
    const promise = original.call(this, image, options);
    void promise.then(
      () => finish("returned"),
      () => finish("failed"),
    );
    return promise;
  };
  return () => {
    transport.pull = original;
  };
}

/** Select the historical #855 image once at the normal GenericContainer acquisition boundary.
 * @template {{string: string}} Image
 * @template Result
 * @param {{pull(image: Image, options: {force: boolean, platform: undefined}): Promise<Result>}} client
 * @param {Image} image
 * @param {unknown} selection
 * @param {(record: Record) => void} emit
 */
export function acquireSelectedImage(client, image, selection, emit) {
  if (
    selection !== "rabbitmq" ||
    safeImage(image.string) === "omitted" ||
    !image.string.startsWith("public.ecr.aws/docker/library/rabbitmq:")
  ) {
    throw new Error("Explicit pinned RabbitMQ selection required");
  }
  emit({
    event: "selected-image",
    image: image.string,
    selection,
    logicalCallsMaximum: 1,
  });
  return client.pull(image, { force: false, platform: undefined });
}

/** @param {string} value */
export function safeImage(value) {
  return /^(public\.ecr\.aws\/docker\/library\/(postgres|rabbitmq)|ghcr\.io\/testcontainers\/ryuk):[a-z0-9.-]+@sha256:[a-f0-9]{64}$/.test(
    value,
  )
    ? value
    : "omitted";
}

/** Keep supported pull DEBUG useful without copying free text, URLs or headers from the daemon.
 * @param {unknown} event
 */
export function safePullEvent(event) {
  if (event === null || typeof event !== "object") return { status: "omitted" };
  const statuses = [
    "Pulling fs layer",
    "Downloading",
    "Download complete",
    "Verifying Checksum",
    "Extracting",
    "Pull complete",
    "Waiting",
    "Already exists",
  ];
  const status =
    "status" in event &&
    typeof event.status === "string" &&
    statuses.includes(event.status)
      ? event.status
      : "omitted";
  const detail = "errorDetail" in event ? event.errorDetail : undefined;
  const message =
    detail !== null && typeof detail === "object" && "message" in detail
      ? detail.message
      : "error" in event
        ? event.error
        : undefined;
  return {
    status,
    ...(message === undefined
      ? {}
      : {
          error:
            message === "toomanyrequests: Rate exceeded" ? message : "omitted",
        }),
  };
}

/** @param {() => Promise<undefined | (() => Promise<void>)>} setup
 * @param {() => void} [observed]
 */
export async function runSetupAndTeardown(setup, observed = () => {}) {
  const teardown = await setup();
  try {
    if (teardown === undefined)
      throw new Error("Root setup did not return teardown");
    observed();
  } finally {
    if (teardown !== undefined) await teardown();
  }
}
