// @ts-check
// One SDK/pipeline composition fixture. The HTTP scope is test-owned, not an API request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const privateMarker = "sdk-storage-private";

/** @param {string} endpoint @param {string} release */
export async function emit(endpoint, release) {
  assert.match(endpoint, /^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/u);
  assert.match(release, /^[0-9a-f]{40}$/u);
  /** @type {Map<string, string>} */
  const loaded = new Map();
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (url.startsWith("file:")) {
        const filename = realpathSync(fileURLToPath(url));
        const local = relative(root, filename);
        const dependency = filename.indexOf(`${sep}node_modules${sep}`);
        const label =
          dependency >= 0
            ? `node_modules/${filename
                .slice(dependency + "/node_modules/".length)
                .split(sep)
                .join("/")}`
            : local.split(sep).join("/");
        assert.ok(
          dependency >= 0 ||
            (!local.startsWith("..") && !local.startsWith(sep)),
        );
        assert.ok(loaded.size < 2000);
        loaded.set(
          label,
          createHash("sha256").update(readFileSync(filename)).digest("hex"),
        );
      }
      return result;
    },
  });
  let requests = 0;
  let providerValid = true;
  const body = Buffer.from(privateMarker);
  const server = createServer((request, response) => {
    requests++;
    providerValid &&=
      request.method === "GET" &&
      request.url?.split("?")[0] ===
        `/${privateMarker}-protected/assets/${privateMarker}` &&
      request.headers.authorization?.includes("private-access-key") === true &&
      request.headers["traceparent"] === undefined &&
      request.headers["tracestate"] === undefined;
    request.resume();
    response
      .writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(body.length),
        "x-amz-meta-sha256": privateMarker,
        "x-amz-request-id": "private-provider-id",
        "content-disposition": 'attachment; filename="private-filename"',
      })
      .end(body);
  });
  /** @type {undefined | import("../../apps/backend/src/infrastructure/observability/technical-telemetry.js").TechnicalTelemetry} */
  let sdk;
  try {
    const runtimeUrl = pathToFileURL(
      resolve(
        root,
        "apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js",
      ),
    ).href;
    const storageUrl = pathToFileURL(
      resolve(
        root,
        "apps/backend/dist/infrastructure/object-storage/s3-object-storage.js",
      ),
    ).href;
    /** @type {typeof import("../../apps/backend/src/infrastructure/observability/technical-telemetry-runtime.js")} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled local module, typed from its tracked production source and verified by the runtime module witness.
    const runtime = await import(runtimeUrl);
    /** @type {typeof import("../../apps/backend/src/infrastructure/object-storage/s3-object-storage.js")} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled local module, typed from its tracked production source and verified by the runtime module witness.
    const objectStorage = await import(storageUrl);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    sdk = runtime.technicalTelemetryFromEnvironment({
      environment: {
        INSIDE_OTEL_ENABLED: "true",
        INSIDE_OTEL_ENDPOINT: endpoint,
        INSIDE_OTEL_SAMPLE_RATIO: "1",
      },
      service: "platform-api",
      mode: "test",
      identity: { release, sourceSha: release },
    });
    const storage = objectStorage.createS3ObjectStorage({
      endpoint: `http://127.0.0.1:${address.port}`,
      buckets: {
        protected: `${privateMarker}-protected`,
        public: `${privateMarker}-public`,
        quarantine: `${privateMarker}-quarantine`,
      },
      credentials: {
        accessKeyId: "private-access-key",
        secretAccessKey: "private-secret-key",
      },
      region: "us-east-1",
      forcePathStyle: true,
    });
    const observation = sdk.startHttp({ method: "GET", route: "/pilot" });
    const started = performance.now();
    /** @type {Readonly<Record<string, string | boolean>>} */
    let correlation = {};
    try {
      const object = await observation.run(async () => {
        correlation = sdk?.correlation() ?? {};
        return storage.read("protected", `assets/${privateMarker}`);
      });
      assert.ok(object !== null);
      assert.deepEqual(Buffer.from(object.body), body);
      assert.equal(object.checksumSha256, privateMarker);
      assert.equal(object.contentLength, body.length);
      assert.equal(object.contentType, "application/octet-stream");
      assert.equal(requests, 1);
      assert.equal(providerValid, true);
    } finally {
      observation.finish(200, performance.now() - started);
    }
    await sdk.flush();
    assert.deepEqual(sdk.diagnostics(), {
      droppedSpans: 0,
      failedTraceExports: 0,
      failedMetricExports: 0,
    });
    await sdk.shutdown();
    assert.equal(typeof correlation["traceId"], "string");
    assert.equal(typeof correlation["spanId"], "string");
    for (const path of [
      "apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js",
      "apps/backend/dist/infrastructure/observability/technical-telemetry.js",
      "apps/backend/dist/infrastructure/object-storage/s3-object-storage.js",
      "apps/backend/dist/infrastructure/object-storage/s3-request-observation.js",
    ])
      assert.ok(loaded.has(path));
    return {
      schema: 1,
      trace_id: correlation["traceId"],
      root_id: correlation["spanId"],
      provider_requests: requests,
      body_read: "passed",
      runtime_modules: Object.fromEntries([...loaded].sort()),
    };
  } finally {
    await sdk?.shutdown();
    server.closeAllConnections();
    if (server.listening)
      await new Promise((resolveClose, reject) =>
        server.close((error) =>
          error === undefined ? resolveClose(undefined) : reject(error),
        ),
      );
    assert.equal(server.listening, false);
    hooks.deregister();
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await emit(
      "http://127.0.0.1:14318",
      process.env["SDK_STORAGE_RELEASE"] ?? "",
    );
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stderr.write("sdk-storage-emitter: closed fixture failure\n");
    process.exitCode = 1;
  }
}
