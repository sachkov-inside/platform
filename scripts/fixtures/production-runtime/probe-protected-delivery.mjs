/**
 * Local proof of the production protected-delivery route (#1766) with the actual Caddy binary and
 * the production `platform.caddy`. The probe replaces the site addresses with plain HTTP, adds
 * `admin off` and points the web, API, MCP and storage upstream placeholders at a fake web and a
 * fake storage on loopback; the bucket host Caddy accepts and sends stays the production one. Signed addresses come from the AWS SDK with the
 * production signing shape (virtual-host bucket on storage.yandexcloud.net, ru-central1).
 *
 * Run from the repository root: `CADDY_EXECUTABLE=<caddy 2.11.4> node scripts/fixtures/production-runtime/probe-protected-delivery.mjs`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

import { spawnOwned, stopOwned } from "../../owned-process.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const source =
  process.env.CADDY_SOURCE_FILE ??
  resolve(repositoryRoot, "infra/production/runtime/platform.caddy");
const caddy = process.env.CADDY_EXECUTABLE ?? "caddy";
const port = Number(process.env.CADDY_PROBE_PORT ?? 18516);
const bucket = "inside-production-protected";
const bucketHost = `${bucket}.storage.yandexcloud.net`;
const immutable = "private, max-age=31536000, immutable";
const noStore = "private, no-store";
const refreshedSession = "logto_session=refreshed; Path=/; HttpOnly; Secure";

const requireBackend = createRequire(
  resolve(repositoryRoot, "apps/backend/package.json"),
);
const { GetObjectCommand, S3Client } = requireBackend("@aws-sdk/client-s3");
const { getSignedUrl } = requireBackend("@aws-sdk/s3-request-presigner");
const signer = new S3Client({
  credentials: {
    accessKeyId: "probe-access-key",
    secretAccessKey: "probe-secret-key",
  },
  endpoint: "https://storage.yandexcloud.net",
  forcePathStyle: false,
  region: "ru-central1",
});
/** The same command `createS3ObjectStorage().signGet` sends for a protected object. */
function sign(key, overrides = {}, bucketName = bucket) {
  return getSignedUrl(
    signer,
    new GetObjectCommand({ Bucket: bucketName, Key: key, ...overrides }),
    { expiresIn: 60 },
  );
}

const ids = {
  material: "10000000-0000-4000-8000-000000000001",
  asset: "20000000-0000-4000-8000-000000000001",
  product: "30000000-0000-4000-8000-000000000001",
  artifact: "40000000-0000-4000-8000-000000000001",
  avatar: "50000000-0000-4000-8000-000000000001",
};
const imageBytes = Buffer.from("RIFF-probe-webp-image-bytes");
const fileBytes = Buffer.from("%PDF-probe-protected-file-0123456789");
const objects = new Map([
  ["materials/m1/assets/a1/image-960.webp", { body: imageBytes }],
  ["materials/m1/assets/a1/source.pdf", { body: fileBytes }],
  ["profiles/p1/avatar-160.webp", { body: imageBytes }],
]);
const disposition =
  "attachment; filename=\"download\"; filename*=UTF-8''%D0%A1%D0%BF%D1%80%D0%B0%D0%B2%D0%BA%D0%B0%20v2.pdf";
const signed = {
  image: await sign("materials/m1/assets/a1/image-960.webp", {
    ResponseContentType: "image/webp",
  }),
  file: await sign("materials/m1/assets/a1/source.pdf", {
    ResponseContentDisposition: disposition,
    ResponseContentType: "application/pdf",
  }),
  avatar: await sign("profiles/p1/avatar-160.webp", {
    ResponseContentType: "image/webp",
  }),
  missing: await sign("status-404/materials/gone.webp"),
  forbidden: await sign("status-403/products/artifact.pdf"),
  moved: await sign("status-301/products/source.pdf"),
  failing: await sign("status-500/materials/image.webp"),
  unsatisfiable: await sign("status-416/materials/source.pdf"),
  foreignBucket: await sign(
    "materials/m1/assets/a1/image-960.webp",
    {},
    "inside-production-public",
  ),
};
assert.ok(
  signed.image.startsWith(`https://${bucketHost}/materials/`),
  `production signing shape changed: ${signed.image}`,
);

const paths = {
  image: `/api/materials/${ids.material}/assets/${ids.asset}/images/960?contentVersion=3`,
  file: `/api/materials/${ids.material}/assets/${ids.asset}?contentVersion=3`,
  preview: `/api/materials/${ids.material}/assets/${ids.asset}/images/960?contentVersion=3&preview=true`,
  avatar: `/api/account/profile/avatar/${ids.avatar}/160`,
  task: `/api/products/${ids.product}/tasks/task-1/assets/${ids.asset}?width=640`,
  artifact: `/api/products/${ids.product}/artifacts/${ids.artifact}/file?version=2`,
  source: `/api/products/${ids.product}/artifact-sources/${ids.artifact}/file`,
  failing: `/api/materials/${ids.material}/assets/${ids.asset}/images/480?contentVersion=3`,
  unsatisfiable: `/api/materials/${ids.material}/assets/${ids.asset}?contentVersion=4`,
  foreignBucket: `/api/materials/${ids.material}/assets/${ids.asset}/images/320?contentVersion=3`,
  hostSuffix: `/api/materials/${ids.material}/assets/${ids.asset}/images/640?contentVersion=3`,
  encodedPath: `/api/materials/${ids.material}/assets/${ids.asset}/images/1280?contentVersion=3`,
  emptySegment: `/api/materials/${ids.material}/assets/${ids.asset}/images/1920?contentVersion=3`,
  denied: `/api/materials/${ids.material}/assets/${ids.asset}?contentVersion=9`,
  legacy: `/api/materials/${ids.material}/assets/${ids.asset}?contentVersion=5`,
  other: "/api/reading/progress",
};
/** What the fake web (Next BFF + API) answers on each path. */
const webAnswers = new Map([
  [paths.image, edge(signed.image, immutable)],
  [paths.file, edge(signed.file, immutable)],
  [paths.preview, edge(signed.image, noStore)],
  [paths.avatar, edge(signed.avatar)],
  [paths.task, edge(signed.missing, noStore)],
  [paths.artifact, edge(signed.forbidden, noStore)],
  [paths.source, edge(signed.moved, noStore)],
  [paths.failing, edge(signed.failing, immutable)],
  [paths.unsatisfiable, edge(signed.unsatisfiable, immutable)],
  [paths.foreignBucket, edge(signed.foreignBucket, immutable)],
  [
    paths.hostSuffix,
    edge(
      signed.image.replace(bucketHost, `${bucketHost}.attacker.example`),
      immutable,
    ),
  ],
  [
    paths.encodedPath,
    edge(
      signed.image.replace("/materials/", "/%2e%2e/materials/"),
      immutable,
    ),
  ],
  [
    paths.emptySegment,
    edge(signed.image.replace("/materials/", "/materials//"), immutable),
  ],
  [
    paths.denied,
    {
      status: 404,
      headers: {
        "cache-control": noStore,
        "content-type": "application/problem+json",
      },
      body: JSON.stringify({ code: "asset_not_found", status: 404 }),
    },
  ],
  [
    paths.legacy,
    {
      status: 302,
      headers: { "cache-control": noStore, location: signed.image },
    },
  ],
  [
    paths.other,
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-inside-storage-location": signed.image,
        "x-inside-storage-cache-control": immutable,
      },
      body: "{}",
    },
  ],
]);
function edge(location, cacheControl) {
  return {
    status: 204,
    headers: {
      "cache-control": noStore,
      // The BFF may refresh the reader's session on any request; the browser must receive it.
      "set-cookie": refreshedSession,
      "x-content-type-options": "nosniff",
      "x-inside-storage-location": location,
      ...(cacheControl === undefined
        ? {}
        : { "x-inside-storage-cache-control": cacheControl }),
    },
  };
}

const webCalls = [];
const storageCalls = [];
const web = createServer((incoming, response) => {
  webCalls.push({
    method: incoming.method,
    url: incoming.url,
    marker: incoming.headers["x-inside-storage-delivery"],
    cookie: incoming.headers.cookie,
  });
  const answer = webAnswers.get(incoming.url ?? "") ?? {
    status: 404,
    headers: {},
  };
  response.writeHead(answer.status, answer.headers);
  response.end(answer.body);
});
const storage = createServer((incoming, response) => {
  storageCalls.push({
    method: incoming.method,
    host: incoming.headers.host,
    url: incoming.url,
    headers: { ...incoming.headers },
  });
  const url = new URL(incoming.url ?? "/", "http://storage.invalid");
  const key = url.pathname.slice(1);
  const failure = /^status-(\d{3})\//u.exec(key);
  const leaky = {
    "x-amz-request-id": "probe-request-id",
    "x-amz-meta-sha256": "a".repeat(64),
    server: "AmazonS3",
    "set-cookie": "storage-session=1; Path=/",
    "strict-transport-security": "max-age=1",
  };
  if (failure !== null) {
    response.writeHead(Number(failure[1]), {
      ...leaky,
      "content-type": "application/xml",
      location: "https://storage-mirror.invalid/",
    });
    response.end("<Error><Code>Probe</Code><RequestId>secret</RequestId></Error>");
    return;
  }
  const object = objects.get(key);
  if (object === undefined) {
    response.writeHead(404, leaky);
    response.end();
    return;
  }
  const headers = {
    ...leaky,
    "accept-ranges": "bytes",
    "content-type":
      url.searchParams.get("response-content-type") ??
      "application/octet-stream",
    etag: '"probe-etag"',
    "last-modified": "Wed, 28 Oct 2026 00:00:00 GMT",
    ...(url.searchParams.has("response-content-disposition")
      ? {
          "content-disposition": url.searchParams.get(
            "response-content-disposition",
          ),
        }
      : {}),
  };
  const range = /^bytes=(\d+)-(\d+)$/u.exec(incoming.headers.range ?? "");
  if (range !== null) {
    const [start, end] = [Number(range[1]), Number(range[2])];
    const part = object.body.subarray(start, end + 1);
    response.writeHead(206, {
      ...headers,
      "content-length": String(part.length),
      "content-range": `bytes ${start}-${end}/${object.body.length}`,
    });
    response.end(part);
    return;
  }
  response.writeHead(200, {
    ...headers,
    "content-length": String(object.body.length),
  });
  response.end(object.body);
});

/** A browser-like request carrying everything storage must never receive. */
const browserHeaders = {
  accept: "image/avif,image/webp,*/*",
  "accept-language": "ru-RU,ru",
  authorization: "Bearer reader-session-token",
  cookie: "logto_session=reader-secret; inside.consent=1",
  "if-none-match": '"stale-etag"',
  origin: "https://sachkov.dev",
  referer: "https://sachkov.dev/library/materials/closed",
  "sec-fetch-dest": "image",
  "sec-fetch-site": "same-origin",
  "user-agent": "probe-browser/1.0",
  "x-forwarded-for": "203.0.113.7",
  "x-inside-storage-delivery": "forged",
};

function query(method, path, headers = {}, host = "sachkov.dev") {
  return new Promise((done, reject) => {
    const outgoing = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { ...headers, host: `${host}:${port}` },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          done({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function listen(server) {
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => done(server.address().port));
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}

const forbiddenUpstream = [
  "authorization",
  "cookie",
  "forwarded",
  "if-none-match",
  "origin",
  "referer",
  "via",
];
function assertCleanStorageCall(call, signedUrl) {
  const expected = new URL(signedUrl);
  assert.equal(call.method, "GET");
  assert.equal(call.host, bucketHost);
  assert.equal(call.url, `${expected.pathname}${expected.search}`);
  for (const name of Object.keys(call.headers)) {
    assert.ok(
      !forbiddenUpstream.includes(name) &&
        !name.startsWith("x-") &&
        !name.startsWith("sec-"),
      `storage received client header ${name}`,
    );
  }
}
function assertNoInternalHeaders(response) {
  for (const name of Object.keys(response.headers)) {
    assert.ok(
      !name.startsWith("x-inside-") && !name.startsWith("x-amz-"),
      `client received ${name}`,
    );
  }
  for (const cookie of response.headers["set-cookie"] ?? [])
    assert.equal(cookie, refreshedSession, "a storage cookie reached the client");
  assert.notEqual(response.headers.server, "AmazonS3");
  assert.ok(!response.body.toString("latin1").includes("X-Amz-Signature"));
}
function assertCleanFailure(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.body.length, 0);
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers["cache-control"], noStore);
  assertNoInternalHeaders(response);
}

const directory = await mkdtemp(resolve(tmpdir(), "inside-1766-caddy-"));
let child;
const results = [];
function record(name, response, extra = {}) {
  const entry = {
    case: name,
    status: response.status,
    cacheControl: response.headers["cache-control"],
    contentType: response.headers["content-type"],
    contentLength: response.headers["content-length"],
    bytes: response.body.length,
    ...extra,
  };
  results.push(entry);
  console.log(JSON.stringify(entry));
}
try {
  const webPort = await listen(web);
  const storagePort = await listen(storage);
  const text = (await readFile(source, "utf8"))
    .replace(
      "sachkov.dev, inside.sachkov.dev {",
      `http://sachkov.dev:${port}, http://inside.sachkov.dev:${port} {`,
    )
    .replace("www.sachkov.dev {", `http://www.sachkov.dev:${port} {`);
  const config = resolve(directory, "Caddyfile");
  await writeFile(config, `{\n\tadmin off\n}\n${text}`);
  const version = execFileSync(caddy, ["version"], { encoding: "utf8" }).trim();
  console.log(JSON.stringify({ caddy: version, source }));
  child = spawnOwned(
    caddy,
    ["run", "--config", config, "--adapter", "caddyfile"],
    {
      env: {
        ...process.env,
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
        PLATFORM_API_UPSTREAM: `127.0.0.1:${webPort}`,
        PLATFORM_MCP_UPSTREAM: `127.0.0.1:${webPort}`,
        PLATFORM_WEB_UPSTREAM: `127.0.0.1:${webPort}`,
        PLATFORM_PROTECTED_STORAGE_UPSTREAM: `http://127.0.0.1:${storagePort}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (part) => (log += part));
  child.stderr.on("data", (part) => (log += part));
  const deadline = performance.now() + 10_000;
  while (true) {
    assert.equal(child.exitCode, null, log);
    try {
      await query("GET", "/health");
      break;
    } catch (error) {
      if (performance.now() > deadline) throw error;
      await setTimeout(50);
    }
  }

  // Image: bytes from the site origin, signed address delivered byte for byte, nothing leaks.
  let before = storageCalls.length;
  const image = await query("GET", paths.image, browserHeaders);
  record("image", image);
  assert.equal(image.status, 200);
  assert.deepEqual(image.body, imageBytes);
  assert.equal(image.headers["content-type"], "image/webp");
  assert.equal(image.headers["content-length"], String(imageBytes.length));
  assert.equal(image.headers.etag, '"probe-etag"');
  assert.equal(image.headers["cache-control"], immutable);
  assert.equal(image.headers["x-content-type-options"], "nosniff");
  assert.equal(
    image.headers["content-security-policy"],
    "default-src 'none'; sandbox",
  );
  assert.equal(image.headers["x-robots-tag"], "noindex, nofollow");
  assert.deepEqual(image.headers["set-cookie"], [refreshedSession]);
  // The site's own HSTS stays; the storage value never replaces it.
  assert.equal(image.headers["strict-transport-security"], "max-age=31536000");
  assertNoInternalHeaders(image);
  assert.equal(storageCalls.length, before + 1);
  assertCleanStorageCall(storageCalls.at(-1), signed.image);
  const imageWebCall = webCalls.at(-1);
  assert.equal(imageWebCall.marker, "edge");
  assert.equal(imageWebCall.cookie, browserHeaders.cookie);

  // Download with Range: Content-Disposition and Content-Range pass through.
  before = storageCalls.length;
  const part = await query("GET", paths.file, {
    ...browserHeaders,
    range: "bytes=5-12",
  });
  record("file-range", part, { contentRange: part.headers["content-range"] });
  assert.equal(part.status, 206);
  assert.deepEqual(part.body, fileBytes.subarray(5, 13));
  assert.equal(part.headers["content-range"], `bytes 5-12/${fileBytes.length}`);
  assert.equal(part.headers["content-length"], "8");
  assert.equal(part.headers["content-disposition"], disposition);
  assert.equal(part.headers["content-type"], "application/pdf");
  assert.equal(part.headers["cache-control"], immutable);
  assertNoInternalHeaders(part);
  assertCleanStorageCall(storageCalls.at(-1), signed.file);
  assert.equal(storageCalls.at(-1).headers.range, "bytes=5-12");

  const whole = await query("GET", paths.file, browserHeaders);
  record("file", whole, {
    contentDisposition: whole.headers["content-disposition"],
  });
  assert.equal(whole.status, 200);
  assert.deepEqual(whole.body, fileBytes);
  assert.equal(whole.headers["content-length"], String(fileBytes.length));
  assert.equal(whole.headers["content-disposition"], disposition);
  assert.equal(storageCalls.at(-1).headers.range, undefined);

  // HEAD reads the same signed GET and returns headers only.
  const head = await query("HEAD", paths.image, browserHeaders);
  record("image-head", head);
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers["content-length"], String(imageBytes.length));
  assertCleanStorageCall(storageCalls.at(-1), signed.image);

  // Preview keeps no-store; a missing cache instruction falls back to no-store.
  const preview = await query("GET", paths.preview, browserHeaders);
  record("preview", preview);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers["cache-control"], noStore);
  const avatar = await query("GET", paths.avatar, browserHeaders);
  record("avatar-without-cache-instruction", avatar);
  assert.equal(avatar.status, 200);
  assert.equal(avatar.headers["cache-control"], noStore);
  assertCleanStorageCall(storageCalls.at(-1), signed.avatar);

  // Storage failures become clean answers without its body, redirect or headers.
  for (const [name, path, status] of [
    ["storage-404", paths.task, 404],
    ["storage-403", paths.artifact, 502],
    ["storage-301", paths.source, 502],
    ["storage-500", paths.failing, 502],
    ["storage-416", paths.unsatisfiable, 416],
  ]) {
    const response = await query("GET", path, browserHeaders);
    record(name, response);
    assertCleanFailure(response, status);
    assert.deepEqual(response.headers["set-cookie"], [refreshedSession]);
  }

  // Only the protected bucket of the production storage is fetched.
  for (const [name, path] of [
    ["foreign-bucket", paths.foreignBucket],
    ["host-suffix", paths.hostSuffix],
    ["encoded-path", paths.encodedPath],
    ["empty-path-segment", paths.emptySegment],
  ]) {
    before = storageCalls.length;
    const response = await query("GET", path, browserHeaders);
    record(name, response);
    assertCleanFailure(response, 502);
    assert.equal(storageCalls.length, before, `${name} reached storage`);
  }

  // Denial and the pre-#1766 redirect pass through unchanged; storage is not touched.
  before = storageCalls.length;
  const denied = await query("GET", paths.denied, browserHeaders);
  record("denied", denied);
  assert.equal(denied.status, 404);
  assert.match(denied.body.toString("utf8"), /asset_not_found/u);
  const legacy = await query("GET", paths.legacy, browserHeaders);
  record("legacy-redirect", legacy);
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.location, signed.image);
  assert.equal(storageCalls.length, before);

  // Outside the route: no marker reaches web, a client-forged one is dropped, and an internal
  // header from web never reaches the client.
  const other = await query("GET", paths.other, browserHeaders);
  record("other-path", other);
  assert.equal(other.status, 200);
  assert.equal(webCalls.at(-1).marker, undefined);
  assertNoInternalHeaders(other);
  const post = await query("POST", paths.image, browserHeaders);
  record("post-protected-path", post);
  assert.equal(webCalls.at(-1).method, "POST");
  assert.equal(webCalls.at(-1).marker, undefined);
  assertNoInternalHeaders(post);
  const legacyHost = await query(
    "GET",
    paths.image,
    browserHeaders,
    "inside.sachkov.dev",
  );
  record("legacy-hostname", legacyHost, {
    location: legacyHost.headers.location,
  });
  assert.equal(legacyHost.status, 302);
  assert.equal(legacyHost.headers.location, `https://sachkov.dev${paths.image}`);

  // Storage unreachable: a clean 502 from the site, no upstream detail.
  before = webCalls.length;
  await close(storage);
  const unreachable = await query("GET", paths.image, browserHeaders);
  record("storage-unreachable", unreachable);
  assert.equal(unreachable.status, 502);
  assert.equal(unreachable.body.length, 0);
  assertNoInternalHeaders(unreachable);
  assert.equal(webCalls.length, before + 1);

  console.log(
    JSON.stringify({
      source,
      cases: results.length,
      storageCalls: storageCalls.length,
      webCalls: webCalls.length,
      result: "pass",
    }),
  );
} finally {
  if (child) await stopOwned(child);
  await close(web);
  await close(storage);
  await rm(directory, { recursive: true, force: true });
}
