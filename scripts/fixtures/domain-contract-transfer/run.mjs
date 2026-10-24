/** Local incompatible transfer proof. Separately built artifacts and synthetic databases only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, cp, rm, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { spawnOwned } from "../../owned-process.mjs";
import { commandExit } from "../../diagnostic-command.mjs";
import { startFullStackIdentity } from "../../full-stack-identity.mjs";
import { snapshotDatabase } from "../domain-restore/postgres.mjs";
import {
  ids,
  ground,
  payment,
  billing,
  ownAccess,
  sourceInput,
  definition,
  task,
  largeBytesDefinition,
  sequenceRequest,
} from "./fixtures.mjs";
import { hashArtifact, sourceIdentity } from "./artifacts.mjs";
import {
  bounded,
  failureBudgets,
  createTransferOwnership,
  stopDiagnosticChild,
} from "./lifetime.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const legacy = process.env.DOMAIN_TRANSFER_LEGACY_ROOT;
assert(legacy, "Explicit immutable legacy build context required");
const artifacts = resolve(
  process.env.DOMAIN_TRANSFER_ARTIFACTS ??
    resolve(root, ".reports/1712-artifacts"),
);
const output = resolve(
  process.env.DOMAIN_TRANSFER_EVIDENCE_DIRECTORY ??
    resolve(root, ".reports/1712-transfer"),
);
await mkdir(output, { recursive: true });
assert.equal(
  (await readdir(output)).length,
  0,
  "Use a fresh transfer evidence directory",
);
const manifests = Object.fromEntries(
  await Promise.all(
    ["legacy", "current"].map(async (variant) => [
      variant,
      JSON.parse(
        await readFile(resolve(artifacts, variant, "manifest.json"), "utf8"),
      ),
    ]),
  ),
);
const currentContext = root;
const contexts = { legacy, current: currentContext };
const records = [];
const children = new Set();
const exited = [];
let producerValue = billing();
const requests = [];
const producer = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  requests.push({
    path: req.url,
    authorizationPresent: typeof req.headers.authorization === "string",
    body: Buffer.concat(chunks).toString("utf8"),
  });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(producerValue));
});
producer.requestTimeout = failureBudgets.http;
producer.headersTimeout = failureBudgets.http;
let producerOrigin;
let identity;
let ownership;
let postgres;
let originalFailure;
const cleanupOutcomes = [];
let pools = [];
const pg = await import(
  pathToFileURL(resolve(root, "apps/backend/node_modules/pg/lib/index.js")).href
);
const Pool = pg.default.Pool;
function event(phase, facts = {}) {
  const record = { phase, ...facts };
  records.push(record);
  console.log(JSON.stringify(record));
}
function dist(variant, app) {
  return resolve(contexts[variant], "apps", app, "dist");
}
async function verifyBuild(variant, app) {
  const base =
    app === "web"
      ? resolve(contexts[variant], "apps/web/.next/standalone")
      : dist(variant, app);
  const prefix = app === "web" ? "standalone" : "dist";
  assert.deepEqual(
    await sourceIdentity(contexts[variant]),
    manifests[variant].source,
    `${variant} source changed since build`,
  );
  const actual = await hashArtifact(base, prefix);
  assert.deepEqual(
    actual,
    manifests[variant].artifacts[app],
    `${variant}/${app} immutable build drift`,
  );
  event("built-artifact-bound", {
    variant,
    app,
    sha256: actual.sha256,
    source: manifests[variant].source,
  });
}
function describeFailure(error) {
  return {
    message: String(error.message ?? error),
    stack: error.stack,
    errors:
      error instanceof AggregateError
        ? error.errors.map(describeFailure)
        : undefined,
  };
}
async function settleCapability(child, original) {
  try {
    await stopDiagnosticChild(child, children);
  } catch (error) {
    cleanupOutcomes.push({
      resource: `child:${child.pid}`,
      success: false,
      failure: describeFailure(error),
    });
    process.exitCode ||= 1;
    throw original
      ? new AggregateError(
          [original, error],
          "Capability and cleanup both failed",
          { cause: original },
        )
      : error;
  }
}
async function run(job) {
  const child = spawnOwned(
    process.execPath,
    [resolve(root, "scripts/fixtures/domain-contract-transfer/reader.mjs")],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const complete = commandExit(child);
  child.stdin.end(
    JSON.stringify({
      ...job,
      context: contexts[job.variant],
      dist: dist(job.variant, job.app),
    }),
  );
  let capabilityFailure;
  try {
    const code = await bounded(
      `${job.app}/${job.operation}`,
      failureBudgets.capability,
      () => complete,
      ownership.signal,
    );
    assert.equal(code, 0, stderr || stdout);
    const line = stdout
      .split("\n")
      .find((v) => v.startsWith("ARTIFACT_RESULT="));
    assert(line, "Child did not return its capability result");
    const value = JSON.parse(line.slice("ARTIFACT_RESULT=".length));
    assert(Number.isInteger(value.pid));
    return value.result;
  } catch (error) {
    capabilityFailure = error;
    throw error;
  } finally {
    try {
      await settleCapability(child, capabilityFailure);
    } finally {
      exited.push({
        app: job.app,
        variant: job.variant,
        operation: job.operation,
        code: child.exitCode,
        signal: child.signalCode,
        settled: !children.has(child),
      });
      await writeFile(
        resolve(
          output,
          `${exited.length}-${job.app}-${job.variant}-${job.operation}.log`,
        ),
        stdout + stderr,
      );
    }
  }
}
async function pool(url) {
  const result = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: failureBudgets.database,
    query_timeout: failureBudgets.database,
    statement_timeout: failureBudgets.database,
  });
  pools.push(result);
  return result;
}
async function webMatrix(variant) {
  const runtime = resolve(output, `runtime-${variant}`);
  await cp(resolve(artifacts, variant, "web/standalone"), runtime, {
    recursive: true,
    dereference: false,
  });
  const cwd = resolve(runtime, "apps/web");
  const sha = manifests[variant].source[0];
  await writeFile(
    resolve(cwd, "release-identity.json"),
    JSON.stringify({ release: "v1", sourceSha: sha }),
  );
  const child = spawnOwned(process.execPath, [resolve(cwd, "server.js")], {
    cwd,
    env: {
      ...process.env,
      ...identity.environment,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: "18514",
      BACKEND_BASE_URL: producerOrigin,
      PLATFORM_RELEASE_VERSION: "v1",
      PLATFORM_SOURCE_SHA: sha,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let log = "";
  let readerFailure;
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  try {
    const deadline = performance.now() + 30000;
    while (true) {
      assert.equal(child.exitCode, null, log);
      try {
        await bounded(
          "Web readiness HTTP/body",
          failureBudgets.http,
          async (signal) => {
            const response = await fetch(
              "http://127.0.0.1:18514/api/account/billing",
              { signal },
            );
            await response.arrayBuffer();
          },
          ownership.signal,
        );
        break;
      } catch (error) {
        if (ownership.signal.aborted || performance.now() > deadline)
          throw error;
        await setTimeout(100);
      }
    }
    const token = await identity.createAccessToken();
    const cookie = await identity.createSession(token);
    const cases = [
      [
        "baseline",
        { ...billing(), subscription: null, grounds: [ground] },
        200,
      ],
      [
        "nullable-ground-start",
        {
          ...billing({ access: { grounds: [{ ...ground, startsAt: null }] } }),
          subscription: null,
          grounds: [{ ...ground, startsAt: null }],
        },
        variant === "legacy" ? 502 : 200,
      ],
      ...["course_activation", "unknown"].map((source) => [
        `source-${source}`,
        {
          ...billing({ access: { grounds: [{ ...ground, source }] } }),
          subscription: null,
          grounds: [{ ...ground, source }],
        },
        variant === "legacy" ? 502 : 200,
      ]),
      [
        "unresolved-partial-refund",
        {
          ...billing({
            payments: [{ ...payment, kind: "initial", refundedKopecks: null }],
          }),
          subscription: null,
          grounds: [ground],
        },
        variant === "legacy" ? 502 : 200,
      ],
      ["canonical-envelope", billing(), variant === "legacy" ? 502 : 200],
    ];
    for (const [name, value, status] of cases) {
      producerValue = value;
      const { response, body } = await bounded(
        "Web reader HTTP/body",
        failureBudgets.http,
        async (signal) => {
          const response = await fetch(
            "http://127.0.0.1:18514/api/account/billing",
            {
              headers: { cookie: `${identity.cookieName}=${cookie}` },
              signal,
            },
          );
          return { response, body: await response.json() };
        },
        ownership.signal,
      );
      event("web-reader", {
        variant,
        name,
        status: response.status,
        expected: status,
      });
      assert.equal(response.status, status, JSON.stringify(body));
      if (status === 200) assert.equal(body.ok, true);
    }
  } catch (error) {
    readerFailure = error;
    throw error;
  } finally {
    try {
      await settleCapability(child, readerFailure);
    } finally {
      await writeFile(resolve(output, `web-${variant}.log`), log);
      await rm(runtime, { recursive: true, force: true });
    }
  }
  event("web-drained", { variant, active: children.size });
}
try {
  ownership = await createTransferOwnership(output);
  for (const variant of ["legacy", "current"])
    for (const app of ["backend", "telegram", "web"])
      await verifyBuild(variant, app);
  await new Promise((ready, reject) => {
    producer.once("error", reject);
    producer.listen(0, "127.0.0.1", ready);
  });
  producerOrigin = `http://127.0.0.1:${producer.address().port}`;
  identity = await startFullStackIdentity({
    apiBaseUrl: producerOrigin,
    webBaseUrl: "http://127.0.0.1:18514",
  });
  for (const variant of ["legacy", "current"]) {
    for (const firstIssuedAt of ["2026-10-01T00:00:00.000Z", null]) {
      const result = await run({
        app: "backend",
        variant,
        operation: "product-access-parse",
        input: {
          accountId: ids.actor,
          productId: ids.product,
          firstIssuedAt,
          access: "active",
          revision: 1,
        },
      });
      event("product-access-reader", {
        variant,
        firstIssuedAt,
        accepted: result.accepted,
        reason: result.reason,
      });
      assert.equal(result.accepted, variant === "current");
      if (variant === "legacy")
        assert.equal(result.reason, "product_access_contract_absent");
    }
  }
  postgres = await ownership.postgres();
  const backend = await postgres.emptyDatabase();
  const telegram = await postgres.emptyDatabase();
  await run({
    app: "backend",
    variant: "legacy",
    operation: "migrate",
    databaseUrl: backend.url,
  });
  await run({
    app: "telegram",
    variant: "legacy",
    operation: "migrate",
    databaseUrl: telegram.url,
  });
  const backendPool = await pool(backend.url),
    telegramPool = await pool(telegram.url);
  await backendPool.query(
    "insert into materials.series(id,slug,name,source_id) values($1,'original-product','Original Product','opaque:series-source')",
    [ids.product],
  );
  await backendPool.query(
    "insert into materials.product_chapters(id,product_id,ordinal,name) values($1,$2,1,'Original chapter')",
    [ids.chapter, ids.product],
  );
  const small = task(definition);
  const applied = await run({
    app: "backend",
    variant: "legacy",
    operation: "task-apply",
    databaseUrl: backend.url,
    input: { ...small, expectedRevision: null },
    actor: ids.actor,
    key: "original-task-key",
  });
  assert.equal(applied.ok, true);
  const sourceReceipt = await run({
    app: "backend",
    variant: "legacy",
    operation: "source-apply",
    databaseUrl: backend.url,
    input: sourceInput,
    actor: ids.actor,
    key: "original-source-key",
  });
  assert.equal(sourceReceipt.ok, true);
  const oldSequence = sequenceRequest();
  const saved = await run({
    app: "telegram",
    variant: "legacy",
    operation: "sequence",
    databaseUrl: telegram.url,
    input: oldSequence,
  });
  assert.equal(saved.accepted, true);
  event("legacy-built-providers-ready", {
    source: manifests.legacy.source,
    taskReceipt: applied,
    sourceReceipt,
  });
  for (const [name, value] of [
    ["small", definition],
    ["result-16000", { ...definition, result: ["x".repeat(16000)] }],
    ["definition-129KiB", largeBytesDefinition()],
  ]) {
    const value_ = await run({
      app: "backend",
      variant: "legacy",
      operation: "task-validate",
      databaseUrl: backend.url,
      input: task(value),
      actor: ids.actor,
    });
    event("backend-reader", { variant: "legacy", name, accepted: value_.ok });
    assert.equal(value_.ok, name === "small");
  }
  for (const [name, value] of [
    ["known-date", ground],
    ["unknown-date", { ...ground, startsAt: null }],
    ["new-origin", { ...ground, source: "course_activation" }],
    ["unknown-origin", { ...ground, source: "unknown" }],
  ]) {
    producerValue = ownAccess(value);
    const result = await run({
      app: "telegram",
      variant: "legacy",
      operation: "own-access",
      endpoint: producerOrigin,
      binding: {
        accountRef: "account",
        telegramIdentityRef: "identity",
        linkRef: "link",
        linkRevision: 1,
      },
    });
    event("telegram-reader", {
      variant: "legacy",
      name,
      accepted: result.accepted,
    });
    assert.equal(result.accepted, name === "known-date");
  }
  await webMatrix("legacy");
  assert.equal(children.size, 0);
  event("old-consumers-drained", { active: 0, exited: exited.length });
  const beforeBackend = await snapshotDatabase((q) => backendPool.query(q));
  const beforeTelegram = await snapshotDatabase((q) => telegramPool.query(q));
  const backupBackend = await postgres.backup(backend),
    backupTelegram = await postgres.backup(telegram);
  event("pre-contract-full-backup", {
    backend: { sha256: backupBackend.sha256, bytes: backupBackend.bytes },
    telegram: { sha256: backupTelegram.sha256, bytes: backupTelegram.bytes },
  });
  const restoredBackend = await postgres.emptyDatabase(),
    restoredTelegram = await postgres.emptyDatabase();
  await postgres.restore(backupBackend, restoredBackend);
  await postgres.restore(backupTelegram, restoredTelegram);
  const restoredBackendPool = await pool(restoredBackend.url),
    restoredTelegramPool = await pool(restoredTelegram.url);
  assert.deepEqual(
    await snapshotDatabase((q) => restoredBackendPool.query(q)),
    beforeBackend,
  );
  assert.deepEqual(
    await snapshotDatabase((q) => restoredTelegramPool.query(q)),
    beforeTelegram,
  );
  event("legacy-backup-restored-empty", { exact: true, dispatch: "held" });
  // Contract is allowed only after old consumers have actually exited and full restores succeeded.
  for (const [app, database] of [
    ["backend", backend],
    ["telegram", telegram],
    ["backend", restoredBackend],
    ["telegram", restoredTelegram],
  ])
    await run({
      app,
      variant: "current",
      operation: "migrate",
      databaseUrl: database.url,
    });
  const receipt = await run({
    app: "backend",
    variant: "current",
    operation: "historical-source-receipt",
    databaseUrl: backend.url,
    input: {
      ...sourceInput,
      materialId: sourceReceipt.value.materialId,
      expectedContentVersion: 1,
    },
    actor: ids.actor,
    key: "original-source-key",
  });
  assert.deepEqual(receipt, sourceReceipt);
  const replay = await run({
    app: "backend",
    variant: "current",
    operation: "task-apply",
    databaseUrl: backend.url,
    input: { ...small, expectedRevision: null },
    actor: ids.actor,
    key: "original-task-key",
  });
  assert.deepEqual(replay, applied);
  const oldRejected = await run({
    app: "telegram",
    variant: "current",
    operation: "sequence",
    databaseUrl: telegram.url,
    input: oldSequence,
  });
  assert.equal(oldRejected.accepted, false);
  const historicalReceipt = await run({
    app: "telegram",
    variant: "current",
    operation: "sequence",
    databaseUrl: telegram.url,
    input: {
      contractVersion: "inside-communications-v2",
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      operation: "receipts.read",
      actor: { accountRef: "artifact-author" },
      expectedRevision: 0,
      payload: { receiptOperationId: ids.operation },
    },
  });
  assert.equal(historicalReceipt.accepted, true);
  assert.deepEqual(
    JSON.parse(historicalReceipt.value.receipt.requestJson),
    oldSequence,
  );
  for (const [name, value] of [
    ["small", definition],
    ["result-16000", { ...definition, result: ["x".repeat(16000)] }],
    ["definition-129KiB", largeBytesDefinition()],
  ]) {
    const result = await run({
      app: "backend",
      variant: "current",
      operation: "task-validate",
      databaseUrl: backend.url,
      input: task(value),
      actor: ids.actor,
    });
    event("backend-reader", { variant: "current", name, accepted: result.ok });
    assert.equal(result.ok, true);
  }
  for (const [name, value] of [
    ["known-date", ground],
    ["unknown-date", { ...ground, startsAt: null }],
    ["new-origin", { ...ground, source: "course_activation" }],
    ["unknown-origin", { ...ground, source: "unknown" }],
  ]) {
    producerValue = ownAccess(value);
    const result = await run({
      app: "telegram",
      variant: "current",
      operation: "own-access",
      endpoint: producerOrigin,
      binding: {
        accountRef: "account",
        telegramIdentityRef: "identity",
        linkRef: "link",
        linkRevision: 1,
      },
    });
    event("telegram-reader", {
      variant: "current",
      name,
      accepted: result.accepted,
    });
    assert.equal(result.accepted, true);
  }
  await webMatrix("current");
  event("current-readers-and-providers-ready", {
    source: manifests.current.source,
    originalReceipts: true,
    oldCommandsRejected: true,
    productionRollout: false,
  });
  const canonical = sequenceRequest(true);
  canonical.operationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  canonical.expectedRevision = 1;
  assert.equal(
    (
      await run({
        app: "telegram",
        variant: "current",
        operation: "sequence",
        databaseUrl: telegram.url,
        input: canonical,
      })
    ).accepted,
    true,
  );
  event("canonical-producer-enabled", {
    ordered: true,
    rollingCompatible: false,
  });
} catch (error) {
  originalFailure = describeFailure(error);
  console.error(originalFailure);
  process.exitCode ||= 1;
} finally {
  const cleanup = async (resource, action) => {
    try {
      await action();
      cleanupOutcomes.push({ resource, success: true });
    } catch (error) {
      cleanupOutcomes.push({
        resource,
        success: false,
        failure: String(error.stack ?? error),
      });
      process.exitCode ||= 1;
    }
  };
  for (const child of [...children])
    await cleanup(`child:${child.pid}`, () =>
      stopDiagnosticChild(child, children),
    );
  for (const [index, databasePool] of pools.entries())
    await cleanup(`pool:${index}`, () =>
      bounded("database pool cleanup", failureBudgets.database, () =>
        databasePool.end(),
      ),
    );
  await cleanup("identity", () =>
    bounded("identity server cleanup", failureBudgets.serverCleanup, () =>
      identity?.close(),
    ),
  );
  await cleanup("producer", () =>
    bounded(
      "producer server cleanup",
      failureBudgets.serverCleanup,
      async () => {
        if (!producer.listening) return;
        const closed = new Promise((done, reject) =>
          producer.close((error) => (error ? reject(error) : done())),
        );
        producer.closeAllConnections();
        await closed;
      },
    ),
  );
  await cleanup("Docker ownership", async () => {
    if (ownership) {
      const results = await ownership.close();
      cleanupOutcomes.push(...results);
      if (results.some((result) => !result.success))
        throw new Error("Docker cleanup contained a failed outcome");
    }
  });
  await writeFile(
    resolve(output, "evidence.json"),
    JSON.stringify(
      {
        manifests,
        records,
        exited,
        requests,
        originalFailure,
        cleanupOutcomes,
        resources: {
          activeChildren: children.size,
          ownedPostgresDisposed: cleanupOutcomes.some(
            (outcome) =>
              outcome.resource === "externalDockerOwner" &&
              outcome.success === true,
          ),
        },
        limitation:
          "Local synthetic incompatible transfer only; wider immutable effect/recovery evidence is the separately bound mixed restore proof.",
      },
      null,
      2,
    ),
  );
}
