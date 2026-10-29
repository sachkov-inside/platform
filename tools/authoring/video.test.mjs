// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical } from "./package.mjs";
import { reviewOrigin } from "./local-sync.mjs";
import { tusChunkBytes, tusRetryDelaysMs, uploadVideo } from "./video.mjs";
import {
  sourceVideoReceiptSchema,
  uploadReceiptKey,
  uploadReceiptSchema,
} from "./local-boundaries.mjs";
import { readJournalFile, resourcesOf } from "./test-support.mjs";
import { trustedTargets } from "./target.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const videoId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sourceId = "inside-content:lesson";
const production = trustedTargets.production.id;
const ownerToken = async () => "owner-access-token";
// Every pause is skipped, so a transfer test that waits longer than this is stuck.
const transferTest = { timeout: 15_000 };
// One run sends a failing request this many times before it stops.
const attemptsPerRun = tusRetryDelaysMs.length + 1;

/** @typedef {import("./target.mjs").LocalTransport} LocalTransport */

/** @param {Buffer | string} bytes */
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * @param {import("node:test").TestContext} t
 * @param {{ target?: string; bytes?: Buffer | string }} [options]
 */
async function fixture(
  t,
  { target = reviewOrigin, bytes = "recording-bytes" } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-video-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  await mkdir(state);
  const file = join(directory, "final.mp4");
  await writeFile(file, bytes);
  const journal = {
    schemaVersion: 1,
    target,
    materials: {
      [sourceId]: {
        materialId,
        contentVersion: 2,
        digest: "a".repeat(64),
        access: "closed",
      },
    },
    products: {},
    operations: {},
  };
  await writeFile(join(state, "journal.json"), canonical(journal));
  return {
    state,
    file,
    bytes: Buffer.from(bytes),
    sha256: sha256Of(bytes),
    read: () => readJournalFile(state),
    raw: () => readFile(join(state, "journal.json"), "utf8"),
  };
}

/**
 * The authoring API double: the environment probe, upload init keyed by idempotency key and
 * reconcile, which reports processing once and then ready. A new upload is protected (ADR 0041);
 * `earlierProtected` is what reconcile reports for the earlier upload, `null` for a target that
 * predates ADR 0041 and reports no protection for any Video; `earlierKey` replays the earlier
 * public attempt.
 *
 * @param {{
 *   endpoint?: string;
 *   loseFirstInit?: boolean;
 *   mode?: string;
 *   byteSize?: number;
 *   earlierProtected?: boolean | null;
 *   earlierKey?: string;
 * }} [options]
 */
function providerApi({
  endpoint = "https://uploads.invalid/provider-one",
  loseFirstInit = false,
  mode = "development",
  byteSize = 15,
  earlierProtected = true,
  earlierKey = undefined,
} = {}) {
  /** @type {{ path: string; key: string | undefined }[]} */
  const calls = [];
  /** @type {Map<string, unknown>} */
  const attempts = new Map();
  let lose = loseFirstInit;
  let reconciles = 0;
  return {
    calls,
    /** @type {LocalTransport} */
    async request(path, body, key) {
      calls.push({ path, key });
      if (path === "/authoring/import/materials/environment") return { mode };
      if (path === `/authoring/materials/${materialId}/videos/uploads`) {
        assert.ok(key !== undefined && key.startsWith("video-upload:"));
        assert.deepEqual(body, {
          access: "closed",
          byteSize,
          filename: "final.mp4",
          title: "Финальная запись",
        });
        if (key === earlierKey)
          return {
            providerVideoId: "earlier-provider",
            uploadEndpoint: earlierProviderEndpoint,
            video: {
              videoId: earlierVideoId,
              materialId,
              state: "ready",
              protected: false,
            },
          };
        if (!attempts.has(key))
          attempts.set(key, {
            providerVideoId: "provider-one",
            uploadEndpoint: endpoint,
            video: {
              videoId,
              materialId,
              state: "uploading",
              ...(earlierProtected === null ? {} : { protected: true }),
            },
          });
        if (lose) {
          lose = false;
          throw new Error("Connection lost after the attempt was stored");
        }
        return structuredClone(attempts.get(key));
      }
      if (path === `/authoring/videos/${videoId}/reconcile`)
        return {
          videoId,
          materialId,
          state: ++reconciles >= 2 ? "ready" : "processing",
          durationSeconds: 600,
          protected: true,
        };
      if (path === `/authoring/videos/${earlierVideoId}/reconcile`)
        return {
          videoId: earlierVideoId,
          materialId,
          state: "ready",
          durationSeconds: 600,
          ...(earlierProtected === null ? {} : { protected: earlierProtected }),
        };
      throw new Error(`Unexpected API request: ${path}`);
    },
    attempts,
  };
}

/**
 * A Tus 1.0.0 server double on loopback. It keeps the received bytes. A PATCH fault stores half of
 * the body and then drops the connection, as an interrupted network does; a HEAD fault drops the
 * connection before any answer. `gone` answers every HEAD with that status, and `redirects`
 * answers a path with 307 to another address; `onPatch` runs after each stored part.
 *
 * @param {import("node:test").TestContext} t
 * @param {{
 *   length: number;
 *   faults?: number;
 *   headFaults?: number;
 *   reportedLength?: number;
 *   gone?: number;
 *   redirects?: Record<string, string>;
 *   onPatch?: (count: number) => Promise<void>;
 * }} options
 */
async function tusServer(
  t,
  {
    length,
    faults = 0,
    headFaults = 0,
    reportedLength = length,
    gone,
    redirects = {},
    onPatch = async () => {},
  },
) {
  /** @type {Buffer[]} */
  const stored = [];
  let offset = 0;
  let remainingFaults = faults;
  let remainingHeadFaults = headFaults;
  let patches = 0;
  /** @type {{ method: string; path: string; offset: string | undefined; headers: import("node:http").IncomingHttpHeaders }[]} */
  const requests = [];
  const server = createServer(async (request, response) => {
    const header = request.headers["upload-offset"];
    const path = request.url ?? "";
    requests.push({
      method: request.method ?? "",
      path,
      offset: typeof header === "string" ? header : undefined,
      headers: request.headers,
    });
    if (request.headers["tus-resumable"] !== "1.0.0") {
      response.writeHead(412).end();
      return;
    }
    const location = redirects[path];
    if (location !== undefined) {
      request.resume();
      response.writeHead(307, { location }).end();
      return;
    }
    if (request.method === "HEAD" && remainingHeadFaults > 0) {
      remainingHeadFaults--;
      request.socket.destroy();
      return;
    }
    if (request.method === "HEAD" && gone !== undefined) {
      response.writeHead(gone).end();
      return;
    }
    if (request.method === "HEAD") {
      response
        .writeHead(200, {
          "tus-resumable": "1.0.0",
          "upload-offset": String(offset),
          "upload-length": String(reportedLength),
          "cache-control": "no-store",
        })
        .end();
      return;
    }
    if (request.method !== "PATCH") {
      response.writeHead(405).end();
      return;
    }
    /** @type {Buffer[]} */
    const parts = [];
    for await (const part of request) {
      // Without an encoding a request stream yields bytes.
      if (!Buffer.isBuffer(part)) throw new Error("Request yielded text");
      parts.push(part);
    }
    const body = Buffer.concat(parts);
    if (
      request.headers["content-type"] !== "application/offset+octet-stream" ||
      Number(header) !== offset
    ) {
      response.writeHead(409).end();
      return;
    }
    if (remainingFaults > 0) {
      remainingFaults--;
      const half = body.subarray(0, Math.floor(body.length / 2));
      stored.push(half);
      offset += half.length;
      request.socket.destroy();
      return;
    }
    stored.push(body);
    offset += body.length;
    await onPatch(++patches);
    response
      .writeHead(204, {
        "tus-resumable": "1.0.0",
        "upload-offset": String(offset),
      })
      .end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((accept) => server.close(accept));
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const base = `http://127.0.0.1:${String(address.port)}`;
  /**
   * Sends requests for the provider's HTTPS upload hosts to the loopback double.
   *
   * @type {typeof fetch}
   */
  const fetcher = (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.protocol, "https:");
    assert.ok(
      url.hostname === "kinescope.io" || url.hostname.endsWith(".kinescope.io"),
    );
    return fetch(`${base}${url.pathname}`, init);
  };
  return {
    fetcher,
    requests,
    received: () => Buffer.concat(stored),
    endpoint: "https://uploader.kinescope.io/files/provider-one",
  };
}

/**
 * @param {{ state: string; file: string }} setup
 * @param {{ request: LocalTransport }} api
 * @param {Partial<Parameters<typeof uploadVideo>[0]>} [extra]
 */
const upload = (setup, api, extra = {}) =>
  uploadVideo({
    stateDirectory: setup.state,
    sourceId,
    file: setup.file,
    title: "Финальная запись",
    request: api.request,
    sleep: async () => {},
    ...extra,
  });

/** A recording longer than two Tus chunks, so a transfer takes several PATCH requests. */
const longRecording = () =>
  Buffer.alloc(tusChunkBytes * 2 + 4321, "recording-");

test("a lost init response retries the persisted key and reaches a ready video once", async (t) => {
  const setup = await fixture(t);
  const api = providerApi({ loseFirstInit: true });
  await assert.rejects(upload(setup, api), /Connection lost/u);
  const pending = uploadReceiptSchema.parse(
    Object.values(resourcesOf(await setup.read()))[0],
  );
  assert.equal(pending.phase, "initializing");
  const result = await upload(setup, api);
  assert.deepEqual(result, {
    sourceId,
    materialId,
    videoId,
    providerVideoId: "provider-one",
    durationSeconds: 600,
    sha256: setup.sha256,
  });
  const keys = api.calls
    .filter((call) => call.path.endsWith("/uploads"))
    .map((call) => call.key);
  assert.equal(new Set(keys).size, 1);
  assert.equal(api.attempts.size, 1);
  const journal = await setup.read();
  assert.deepEqual(
    sourceVideoReceiptSchema.parse(
      resourcesOf(journal)[`source-video:${sourceId}`],
    ).videoId,
    videoId,
  );
  const before = api.calls.length;
  await upload(setup, api);
  assert.deepEqual(
    api.calls.slice(before).map((call) => call.path),
    ["/authoring/import/materials/environment"],
  );
});

test("a production upload transfers the file over Tus with the owner's session and the same journal", async (t) => {
  const bytes = longRecording();
  const setup = await fixture(t, { target: production, bytes });
  const tus = await tusServer(t, { length: bytes.length });
  const api = providerApi({
    mode: "production",
    endpoint: tus.endpoint,
    byteSize: bytes.length,
  });
  const result = await upload(setup, api, {
    origin: "production",
    accessToken: ownerToken,
    sha256: setup.sha256,
    fetcher: tus.fetcher,
  });
  assert.equal(result.videoId, videoId);
  assert.ok(tus.received().equals(bytes));
  const patches = tus.requests.filter((item) => item.method === "PATCH");
  assert.deepEqual(
    patches.map((item) => item.offset),
    ["0", String(tusChunkBytes), String(tusChunkBytes * 2)],
  );
  for (const item of patches) {
    assert.equal(item.headers["tus-resumable"], "1.0.0");
    assert.equal(item.headers.authorization, undefined);
  }
  const journal = await setup.read();
  assert.equal(journal["target"], production);
  // The journal keeps the phase and endpoint; the server's offset is never stored.
  assert.doesNotMatch(await setup.raw(), /offset/iu);
});

test(
  "a dropped connection is resent within the run from the server offset",
  transferTest,
  async (t) => {
    const bytes = longRecording();
    const setup = await fixture(t, { target: production, bytes });
    const tus = await tusServer(t, {
      length: bytes.length,
      faults: 1,
      headFaults: 1,
    });
    const api = providerApi({
      mode: "production",
      endpoint: tus.endpoint,
      byteSize: bytes.length,
    });
    const result = await upload(setup, api, {
      origin: "production",
      accessToken: ownerToken,
      sha256: setup.sha256,
      fetcher: tus.fetcher,
    });
    assert.equal(result.videoId, videoId);
    assert.ok(tus.received().equals(bytes));
    // The failed HEAD is repeated, and the part after the dropped connection starts where the server stopped.
    assert.deepEqual(
      tus.requests.slice(0, 3).map((item) => item.method),
      ["HEAD", "HEAD", "PATCH"],
    );
    assert.ok(
      tus.requests.some(
        (item) =>
          item.method === "PATCH" && Number(item.offset) % tusChunkBytes !== 0,
      ),
    );
  },
);

test(
  "an interrupted transfer resumes from the server offset without a second upload",
  transferTest,
  async (t) => {
    const bytes = longRecording();
    const setup = await fixture(t, { target: production, bytes });
    // The first run spends its whole retry budget and stops; the repeated command meets one more drop.
    const tus = await tusServer(t, {
      length: bytes.length,
      faults: attemptsPerRun + 1,
    });
    const api = providerApi({
      mode: "production",
      endpoint: tus.endpoint,
      byteSize: bytes.length,
    });
    const options = {
      origin: "production",
      accessToken: ownerToken,
      sha256: setup.sha256,
      fetcher: tus.fetcher,
    };
    await assert.rejects(upload(setup, api, options), /transfer stopped/u);
    assert.equal(
      uploadReceiptSchema.parse(
        Object.values(resourcesOf(await setup.read()))[0],
      ).phase,
      "transfer",
    );
    const received = tus.received().length;
    assert.ok(received > 0 && received < bytes.length);
    const result = await upload(setup, api, options);
    assert.equal(result.videoId, videoId);
    assert.ok(tus.received().equals(bytes));
    assert.equal(
      api.calls.filter((call) => call.path.endsWith("/uploads")).length,
      1,
    );
    // Each retry continues from the offset the server reports, never from zero.
    const resumed = tus.requests.filter(
      (item) => item.method === "PATCH" && item.offset !== "0",
    );
    assert.ok(
      resumed.some((item) => Number(item.offset) % tusChunkBytes !== 0),
    );
  },
);

test("a trusted target needs the owner's session and the expected checksum", async (t) => {
  const setup = await fixture(t, { target: production });
  const before = await setup.raw();
  await assert.rejects(
    uploadVideo({
      stateDirectory: setup.state,
      sourceId,
      file: setup.file,
      origin: "production",
      sha256: setup.sha256,
    }),
    /pnpm authoring:login --target production/u,
  );
  const api = providerApi({ mode: "production" });
  await assert.rejects(
    upload(setup, api, { origin: "production", accessToken: ownerToken }),
    /--sha256/u,
  );
  assert.equal(await setup.raw(), before);
  assert.deepEqual(api.calls, []);
});

test("a target that answers as another environment is refused before the journal changes", async (t) => {
  const setup = await fixture(t, { target: production });
  const before = await setup.raw();
  const api = providerApi({ mode: "development" });
  await assert.rejects(
    upload(setup, api, {
      origin: "production",
      accessToken: ownerToken,
      sha256: setup.sha256,
    }),
    /reports a development runtime; expected production/u,
  );
  assert.equal(await setup.raw(), before);
  assert.deepEqual(
    api.calls.map((call) => call.path),
    ["/authoring/import/materials/environment"],
  );
});

test("a file with another checksum is refused before any request or journal write", async (t) => {
  for (const origin of ["editor", "production"])
    await t.test(origin, async (t) => {
      const setup = await fixture(t, {
        target: origin === "production" ? production : reviewOrigin,
      });
      const before = await setup.raw();
      const api = providerApi({ mode: "production" });
      await assert.rejects(
        upload(setup, api, {
          origin,
          accessToken: ownerToken,
          sha256: "0".repeat(64),
        }),
        /SHA-256/u,
      );
      await assert.rejects(
        upload(setup, api, { origin, accessToken: ownerToken, sha256: "ABC" }),
        /64 lowercase hex/u,
      );
      assert.deepEqual(api.calls, []);
      assert.equal(await setup.raw(), before);
    });
});

test("an upload whose server length differs from the file stops before any byte", async (t) => {
  const setup = await fixture(t, { target: production });
  const tus = await tusServer(t, { length: 15, reportedLength: 16 });
  const api = providerApi({ mode: "production", endpoint: tus.endpoint });
  await assert.rejects(
    upload(setup, api, {
      origin: "production",
      accessToken: ownerToken,
      sha256: setup.sha256,
      fetcher: tus.fetcher,
    }),
    /Upload-Length 16 differs from the file size 15/u,
  );
  assert.deepEqual(
    tus.requests.map((item) => item.method),
    ["HEAD"],
  );
});

test("bytes go only to a Kinescope HTTPS upload endpoint, whatever the target", async (t) => {
  /** @type {[string, string][]} */
  const cases = [
    ["production", "http://uploader.kinescope.io/files/provider-one"],
    ["production", "https://uploads.invalid/provider-one"],
    ["production", "https://uploader.example.com/files/provider-one"],
    ["production", "https://kinescope.io.example.com/files/provider-one"],
    ["stand", "https://uploader.example.com/files/provider-one"],
    ["stand", "http://127.0.0.1:9/files/provider-one"],
  ];
  for (const [origin, endpoint] of cases)
    await t.test(`${origin} ${endpoint}`, async (t) => {
      const trusted = origin === "production";
      const setup = await fixture(t, {
        target: trusted ? production : "http://127.0.0.1:4398",
      });
      const api = providerApi({
        mode: trusted ? "production" : "development",
        endpoint,
      });
      /** @type {string[]} */
      const fetched = [];
      await assert.rejects(
        upload(setup, api, {
          origin,
          accessToken: ownerToken,
          sha256: setup.sha256,
          fetcher: async (input) => {
            fetched.push(String(input));
            throw new Error("Unexpected fetch");
          },
        }),
        /Kinescope HTTPS upload endpoint/u,
      );
      assert.deepEqual(fetched, []);
    });
});

test("a local target with a real provider transfers the bytes over Tus as well", async (t) => {
  const bytes = longRecording();
  const setup = await fixture(t, { target: "http://127.0.0.1:4398", bytes });
  const tus = await tusServer(t, { length: bytes.length });
  const api = providerApi({ endpoint: tus.endpoint, byteSize: bytes.length });
  // The checksum is optional for a local target.
  const result = await upload(setup, api, {
    origin: "stand",
    fetcher: tus.fetcher,
  });
  assert.equal(result.videoId, videoId);
  assert.ok(tus.received().equals(bytes));
});

test("an unknown upload outcome stops without a new key", async (t) => {
  const setup = await fixture(t, { target: production });
  const api = {
    /** @type {LocalTransport} */
    async request(path) {
      if (path.endsWith("/environment")) return { mode: "production" };
      throw Object.assign(new Error("409"), {
        body: { code: "upload_outcome_unknown" },
      });
    },
  };
  const options = {
    origin: "production",
    accessToken: ownerToken,
    sha256: setup.sha256,
  };
  const first = await upload(setup, api, options).catch(
    (/** @type {unknown} */ error) => error,
  );
  const key = uploadReceiptSchema.parse(
    Object.values(resourcesOf(await setup.read()))[0],
  ).idempotencyKey;
  assert.ok(first instanceof Error);
  assert.match(first.message, /unknown; inspect the attempt/u);
  assert.ok(first.message.includes(key));
  await assert.rejects(upload(setup, api, options), /unknown/u);
  assert.equal(
    uploadReceiptSchema.parse(Object.values(resourcesOf(await setup.read()))[0])
      .idempotencyKey,
    key,
  );
});

test("a Material that was never synchronized cannot receive a recording", async (t) => {
  const setup = await fixture(t);
  await assert.rejects(
    uploadVideo({
      stateDirectory: setup.state,
      sourceId: "inside-content:other",
      file: setup.file,
      request: providerApi().request,
    }),
    /Synchronize/u,
  );
});

test("a failed provider outcome lets the same file start a new attempt", async (t) => {
  const setup = await fixture(t);
  let state = "failed";
  /** @type {(string | undefined)[]} */
  const keys = [];
  const api = {
    /** @type {LocalTransport} */
    async request(path, _body, key) {
      if (path.endsWith("/environment")) return { mode: "development" };
      if (path.endsWith("/uploads")) {
        keys.push(key);
        return {
          providerVideoId: `provider-${String(keys.length)}`,
          uploadEndpoint: "https://uploads.invalid/x",
          video: { videoId, materialId, state: "uploading" },
        };
      }
      if (path.endsWith("/reconcile"))
        return { videoId, materialId, state, durationSeconds: 600 };
      throw new Error(`Unexpected ${path}`);
    },
  };
  await assert.rejects(upload(setup, api), /video is failed/u);
  state = "ready";
  const result = await upload(setup, api);
  assert.equal(new Set(keys).size, 2);
  assert.equal(result.providerVideoId, "provider-2");
});

test(
  "an expired provider upload stops with its Video and key and starts nothing new",
  transferTest,
  async (t) => {
    for (const status of [404, 410])
      await t.test(String(status), async (t) => {
        const setup = await fixture(t, { target: production });
        const tus = await tusServer(t, { length: 15, gone: status });
        const api = providerApi({ mode: "production", endpoint: tus.endpoint });
        const options = {
          origin: "production",
          accessToken: ownerToken,
          sha256: setup.sha256,
          fetcher: tus.fetcher,
        };
        const stopped = await upload(setup, api, options).catch(
          (/** @type {unknown} */ error) => error,
        );
        const receipt = uploadReceiptSchema.parse(
          Object.values(resourcesOf(await setup.read()))[0],
        );
        assert.ok(stopped instanceof Error);
        assert.match(stopped.message, /expired/u);
        assert.ok(stopped.message.includes(videoId));
        assert.ok(stopped.message.includes(receipt.idempotencyKey));
        assert.doesNotMatch(stopped.message, /files\/provider-one/u);
        assert.equal(receipt.phase, "transfer");
        await assert.rejects(upload(setup, api, options), /expired/u);
        assert.equal(
          api.calls.filter((call) => call.path.endsWith("/uploads")).length,
          1,
        );
        assert.equal(
          tus.requests.some((item) => item.method === "PATCH"),
          false,
        );
      });
  },
);

test(
  "a redirect is followed once, and only to another Kinescope HTTPS address",
  transferTest,
  async (t) => {
    const moved = "https://upload-2.kinescope.io/files/moved";
    await t.test("to Kinescope", async (t) => {
      const setup = await fixture(t, { target: production });
      const tus = await tusServer(t, {
        length: 15,
        redirects: { "/files/provider-one": moved },
      });
      const api = providerApi({ mode: "production", endpoint: tus.endpoint });
      await upload(setup, api, {
        origin: "production",
        accessToken: ownerToken,
        sha256: setup.sha256,
        fetcher: tus.fetcher,
      });
      assert.ok(tus.received().equals(setup.bytes));
      assert.deepEqual(
        tus.requests.map((item) => `${item.method} ${item.path}`),
        [
          "HEAD /files/provider-one",
          "HEAD /files/moved",
          "PATCH /files/provider-one",
          "PATCH /files/moved",
        ],
      );
    });
    /** @type {[string, Record<string, string>][]} */
    const refused = [
      [
        "outside Kinescope",
        { "/files/provider-one": "https://uploads.example.com/files/moved" },
      ],
      [
        "to plain HTTP",
        { "/files/provider-one": "http://upload-2.kinescope.io/files/moved" },
      ],
      ["twice", { "/files/provider-one": moved, "/files/moved": moved }],
    ];
    for (const [name, redirects] of refused)
      await t.test(name, async (t) => {
        const setup = await fixture(t, { target: production });
        const tus = await tusServer(t, { length: 15, redirects });
        const api = providerApi({ mode: "production", endpoint: tus.endpoint });
        await assert.rejects(
          upload(setup, api, {
            origin: "production",
            accessToken: ownerToken,
            sha256: setup.sha256,
            fetcher: tus.fetcher,
          }),
          /redirected HEAD other than once to a Kinescope HTTPS address/u,
        );
        assert.equal(tus.received().length, 0);
      });
  },
);

const stand = "http://127.0.0.1:4398";
const earlierVideoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const earlierProviderEndpoint =
  "https://uploader.kinescope.io/files/earlier-provider";

/**
 * Stores a ready upload of the fixture's file, as an earlier run left it.
 *
 * @param {{ state: string; sha256: string; read: () => ReturnType<typeof readJournalFile> }} setup
 * @param {string} uploadEndpoint
 */
async function earlierUpload(setup, uploadEndpoint) {
  const journal = await setup.read();
  const resources = (journal.resources ??= {});
  resources[uploadReceiptKey(materialId, setup.sha256)] = {
    sourceId,
    idempotencyKey: "video-upload:earlier",
    byteSize: 15,
    filename: "final.mp4",
    title: "Финальная запись",
    access: "closed",
    phase: "ready",
    videoId: earlierVideoId,
    providerVideoId: "earlier-provider",
    uploadEndpoint,
    durationSeconds: 600,
  };
  resources[`source-video:${sourceId}`] = {
    videoId: earlierVideoId,
    providerVideoId: "earlier-provider",
    sha256: setup.sha256,
  };
  await writeFile(join(setup.state, "journal.json"), canonical(journal));
  return structuredClone(resources);
}

test(
  "--replace-test-upload uploads again a file the test adapter took on a local target",
  transferTest,
  async (t) => {
    const setup = await fixture(t, { target: stand });
    await earlierUpload(setup, "https://uploads.invalid/earlier-provider");
    const tus = await tusServer(t, { length: 15 });
    const api = providerApi({ endpoint: tus.endpoint });
    const options = { origin: "stand", fetcher: tus.fetcher };
    // Without the flag the earlier test receipt answers, and nothing is sent.
    assert.equal(
      (await upload(setup, api, options)).providerVideoId,
      "earlier-provider",
    );
    const result = await upload(setup, api, {
      ...options,
      replaceTestUpload: true,
    });
    assert.equal(result.videoId, videoId);
    assert.equal(result.providerVideoId, "provider-one");
    assert.ok(tus.received().equals(setup.bytes));
    const resources = resourcesOf(await setup.read());
    const receipt = uploadReceiptSchema.parse(
      resources[uploadReceiptKey(materialId, setup.sha256)],
    );
    assert.notEqual(receipt.idempotencyKey, "video-upload:earlier");
    assert.equal(
      sourceVideoReceiptSchema.parse(resources[`source-video:${sourceId}`])
        .videoId,
      videoId,
    );
    // The new upload is real, so repeating the flag returns it without another upload.
    const repeated = await upload(setup, api, {
      ...options,
      replaceTestUpload: true,
    });
    assert.equal(repeated.videoId, videoId);
    assert.equal(
      api.calls.filter((call) => call.path.endsWith("/uploads")).length,
      1,
    );
  },
);

test("--replace-test-upload leaves an upload that reached the real provider and repeats the command", async (t) => {
  await t.test("ready", async (t) => {
    const setup = await fixture(t, { target: stand });
    const before = await earlierUpload(
      setup,
      "https://uploader.kinescope.io/files/earlier-provider",
    );
    const api = providerApi();
    const result = await upload(setup, api, {
      origin: "stand",
      replaceTestUpload: true,
    });
    assert.equal(result.providerVideoId, "earlier-provider");
    assert.deepEqual(resourcesOf(await setup.read()), before);
    assert.deepEqual(
      api.calls.map((call) => call.path),
      ["/authoring/import/materials/environment"],
    );
  });
  // A run whose transfer finished and whose reconcile failed is continued, not refused.
  await t.test("processing", async (t) => {
    const setup = await fixture(t, { target: stand });
    await earlierUpload(
      setup,
      "https://uploader.kinescope.io/files/provider-one",
    );
    const journal = await setup.read();
    const resources = resourcesOf(journal);
    const key = uploadReceiptKey(materialId, setup.sha256);
    resources[key] = {
      ...uploadReceiptSchema.parse(resources[key]),
      phase: "processing",
      videoId,
      providerVideoId: "provider-one",
    };
    delete resources[`source-video:${sourceId}`];
    await writeFile(join(setup.state, "journal.json"), canonical(journal));
    const api = providerApi();
    const result = await upload(setup, api, {
      origin: "stand",
      replaceTestUpload: true,
    });
    assert.equal(result.videoId, videoId);
    assert.equal(
      api.calls.some((call) => call.path.endsWith("/uploads")),
      false,
    );
    assert.equal(
      uploadReceiptSchema.parse(resourcesOf(await setup.read())[key])
        .idempotencyKey,
      "video-upload:earlier",
    );
  });
});

test("--replace-test-upload is refused on a trusted target before any request", async (t) => {
  const setup = await fixture(t, { target: production });
  const before = await setup.raw();
  const api = providerApi({ mode: "production" });
  await assert.rejects(
    upload(setup, api, {
      origin: "production",
      accessToken: ownerToken,
      sha256: setup.sha256,
      replaceTestUpload: true,
    }),
    /--replace-test-upload is only for local targets/u,
  );
  assert.deepEqual(api.calls, []);
  assert.equal(await setup.raw(), before);
});

test(
  "--replace-public-upload uploads again a file whose recording the target reports public",
  transferTest,
  async (t) => {
    const setup = await fixture(t, { target: stand });
    await earlierUpload(setup, earlierProviderEndpoint);
    const tus = await tusServer(t, { length: 15 });
    const api = providerApi({
      endpoint: tus.endpoint,
      earlierProtected: false,
    });
    const options = { origin: "stand", fetcher: tus.fetcher };
    // Without the flag the earlier public receipt answers, and nothing is sent.
    assert.equal(
      (await upload(setup, api, options)).providerVideoId,
      "earlier-provider",
    );
    const result = await upload(setup, api, {
      ...options,
      replacePublicUpload: true,
    });
    assert.equal(result.videoId, videoId);
    assert.equal(result.providerVideoId, "provider-one");
    assert.ok(tus.received().equals(setup.bytes));
    const resources = resourcesOf(await setup.read());
    const receipt = uploadReceiptSchema.parse(
      resources[uploadReceiptKey(materialId, setup.sha256)],
    );
    assert.notEqual(receipt.idempotencyKey, "video-upload:earlier");
    assert.equal(receipt.phase, "ready");
    assert.deepEqual(
      sourceVideoReceiptSchema.parse(resources[`source-video:${sourceId}`]),
      { videoId, providerVideoId: "provider-one", sha256: setup.sha256 },
    );
    // The new upload is protected, so repeating the flag returns it without another upload.
    const repeated = await upload(setup, api, {
      ...options,
      replacePublicUpload: true,
    });
    assert.equal(repeated.videoId, videoId);
    assert.equal(
      api.calls.filter((call) => call.path.endsWith("/uploads")).length,
      1,
    );
  },
);

test("--replace-public-upload replaces an unfinished upload into the public project", async (t) => {
  const setup = await fixture(t, { target: stand });
  await earlierUpload(setup, earlierProviderEndpoint);
  const journal = await setup.read();
  const resources = resourcesOf(journal);
  const key = uploadReceiptKey(materialId, setup.sha256);
  resources[key] = {
    ...uploadReceiptSchema.parse(resources[key]),
    phase: "processing",
  };
  delete resources[`source-video:${sourceId}`];
  await writeFile(join(setup.state, "journal.json"), canonical(journal));
  const api = providerApi({ earlierProtected: false });
  const result = await upload(setup, api, {
    origin: "stand",
    replacePublicUpload: true,
  });
  assert.equal(result.videoId, videoId);
  assert.notEqual(
    uploadReceiptSchema.parse(resourcesOf(await setup.read())[key])
      .idempotencyKey,
    "video-upload:earlier",
  );
});

test("--replace-public-upload leaves a recording that is not public as without the flag", async (t) => {
  await t.test("protected", async (t) => {
    const setup = await fixture(t, { target: stand });
    const before = await earlierUpload(setup, earlierProviderEndpoint);
    const api = providerApi({ earlierProtected: true });
    const result = await upload(setup, api, {
      origin: "stand",
      replacePublicUpload: true,
    });
    assert.equal(result.providerVideoId, "earlier-provider");
    assert.deepEqual(resourcesOf(await setup.read()), before);
    assert.deepEqual(
      api.calls.map((call) => call.path),
      [
        "/authoring/import/materials/environment",
        `/authoring/videos/${earlierVideoId}/reconcile`,
      ],
    );
  });
  // A test-adapter receipt names no provider recording; --replace-test-upload owns it.
  await t.test("test adapter", async (t) => {
    const setup = await fixture(t, { target: stand });
    const before = await earlierUpload(
      setup,
      "https://uploads.invalid/earlier-provider",
    );
    const api = providerApi({ earlierProtected: false });
    const result = await upload(setup, api, {
      origin: "stand",
      replacePublicUpload: true,
    });
    assert.equal(result.providerVideoId, "earlier-provider");
    assert.deepEqual(resourcesOf(await setup.read()), before);
    assert.deepEqual(
      api.calls.map((call) => call.path),
      ["/authoring/import/materials/environment"],
    );
  });
});

// An earlier run whose init answer was lost holds no Video; the replayed answer names it.
test("--replace-public-upload starts anew when a replayed attempt names a public recording", async (t) => {
  const setup = await fixture(t, { target: stand });
  const journal = await setup.read();
  const key = uploadReceiptKey(materialId, setup.sha256);
  (journal.resources ??= {})[key] = {
    sourceId,
    idempotencyKey: "video-upload:earlier",
    byteSize: 15,
    filename: "final.mp4",
    title: "Финальная запись",
    access: "closed",
    phase: "initializing",
  };
  await writeFile(join(setup.state, "journal.json"), canonical(journal));
  const api = providerApi({ earlierKey: "video-upload:earlier" });
  const result = await upload(setup, api, {
    origin: "stand",
    replacePublicUpload: true,
  });
  assert.equal(result.videoId, videoId);
  assert.deepEqual(
    api.calls
      .filter((call) => call.path.endsWith("/uploads"))
      .map((call) => call.key === "video-upload:earlier"),
    [true, false],
  );
  assert.notEqual(
    uploadReceiptSchema.parse(resourcesOf(await setup.read())[key])
      .idempotencyKey,
    "video-upload:earlier",
  );
});

test("both replace flags discard a test-adapter receipt without asking the target", async (t) => {
  const setup = await fixture(t, { target: stand });
  await earlierUpload(setup, "https://uploads.invalid/earlier-provider");
  const api = providerApi();
  const result = await upload(setup, api, {
    origin: "stand",
    replaceTestUpload: true,
    replacePublicUpload: true,
  });
  assert.equal(result.videoId, videoId);
  assert.equal(
    api.calls.some((call) => call.path.includes(earlierVideoId)),
    false,
  );
});

test("--replace-public-upload stops before any byte when a new attempt reports no protection", async (t) => {
  const setup = await fixture(t, { target: stand });
  const api = providerApi({
    endpoint: "https://uploader.kinescope.io/files/provider-one",
    earlierProtected: null,
  });
  await assert.rejects(
    upload(setup, api, { origin: "stand", replacePublicUpload: true }),
    /does not report whether video .* is protected/u,
  );
  const receipt = uploadReceiptSchema.parse(
    resourcesOf(await setup.read())[uploadReceiptKey(materialId, setup.sha256)],
  );
  assert.equal(receipt.phase, "initializing");
});

test("--replace-public-upload stops when the target does not report protection", async (t) => {
  const setup = await fixture(t, { target: stand });
  await earlierUpload(setup, earlierProviderEndpoint);
  const before = await setup.read();
  const api = providerApi({ earlierProtected: null });
  await assert.rejects(
    upload(setup, api, { origin: "stand", replacePublicUpload: true }),
    /does not report whether video .* is protected/u,
  );
  assert.deepEqual(await setup.read(), before);
  assert.equal(
    api.calls.some((call) => call.path.endsWith("/uploads")),
    false,
  );
});

test("--replace-public-upload is refused on a trusted target before any request", async (t) => {
  const setup = await fixture(t, { target: production });
  const before = await setup.raw();
  const api = providerApi({ mode: "production" });
  await assert.rejects(
    upload(setup, api, {
      origin: "production",
      accessToken: ownerToken,
      sha256: setup.sha256,
      replacePublicUpload: true,
    }),
    /--replace-public-upload is only for local targets/u,
  );
  assert.deepEqual(api.calls, []);
  assert.equal(await setup.raw(), before);
});

test(
  "a file changed during the transfer stops before processing and keeps the attempt",
  transferTest,
  async (t) => {
    const bytes = longRecording();
    const setup = await fixture(t, { target: production, bytes });
    // After the first part arrives the file is rewritten in place with other bytes of the same size.
    const tus = await tusServer(t, {
      length: bytes.length,
      onPatch: async (count) => {
        if (count === 1)
          await writeFile(setup.file, Buffer.alloc(bytes.length, "changed-"));
      },
    });
    const api = providerApi({
      mode: "production",
      endpoint: tus.endpoint,
      byteSize: bytes.length,
    });
    await assert.rejects(
      upload(setup, api, {
        origin: "production",
        accessToken: ownerToken,
        sha256: setup.sha256,
        fetcher: tus.fetcher,
      }),
      /changed while it was uploading/u,
    );
    assert.equal(
      uploadReceiptSchema.parse(
        resourcesOf(await setup.read())[
          uploadReceiptKey(materialId, setup.sha256)
        ],
      ).phase,
      "transfer",
    );
    assert.equal(
      api.calls.some((call) => call.path.endsWith("/reconcile")),
      false,
    );
    // The repeated command hashes the file again and refuses the changed bytes.
    await assert.rejects(
      upload(setup, api, {
        origin: "production",
        accessToken: ownerToken,
        sha256: setup.sha256,
        fetcher: tus.fetcher,
      }),
      /SHA-256/u,
    );
  },
);
