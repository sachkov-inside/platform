// @ts-check

/** @typedef {{event: string, [key: string]: unknown}} Record */
/**
 * Observe the SDK boundary without replacing its promise or error. No arbitrary error text is logged.
 * @template {{string: string}} Image
 * @template Options
 * @template Result
 * @param {{pull(image: Image, options?: Options): Promise<Result>}} client
 * @param {(record: Record) => void} emit
 */
export function observePull(client, emit) {
  const original = client.pull;
  client.pull = function (image, options) {
    const started = performance.now();
    emit({
      event: "pull-start",
      image: safeImage(image.string),
      monotonicMs: started,
      force:
        options !== null &&
        typeof options === "object" &&
        "force" in options &&
        typeof options.force === "boolean"
          ? options.force
          : "unspecified",
      platform:
        options !== null &&
        typeof options === "object" &&
        "platform" in options &&
        (options.platform === "linux/amd64" ||
          options.platform === "linux/arm64")
          ? options.platform
          : "daemon-default-or-omitted",
    });
    const promise = original.call(this, image, options);
    void promise.then(
      () =>
        emit({
          event: "pull-complete",
          image: safeImage(image.string),
          elapsedMs: performance.now() - started,
        }),
      () =>
        emit({
          event: "pull-failed",
          image: safeImage(image.string),
          elapsedMs: performance.now() - started,
        }),
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
 */
export function observeAuth(lookup, emit) {
  const original = lookup.getAuthConfig;
  lookup.getAuthConfig = function (registry) {
    const promise = original.call(this, registry);
    void promise.then(
      (result) =>
        emit({
          event: "auth-resolved",
          registry:
            registry === "public.ecr.aws" || registry === "ghcr.io"
              ? registry
              : "omitted",
          present: result !== undefined && result !== null,
        }),
      () => {},
    );
    return promise;
  };
  return () => {
    lookup.getAuthConfig = original;
  };
}

/** @param {string} value */
export function safeImage(value) {
  return /^(public\.ecr\.aws\/docker\/library\/postgres|ghcr\.io\/testcontainers\/ryuk):[a-z0-9.-]+@sha256:[a-f0-9]{64}$/.test(
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
