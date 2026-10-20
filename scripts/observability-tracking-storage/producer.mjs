// @ts-check
// Genuine loopback API -> persisted carrier -> production timer, with owned provider/PG.
import assert from "node:assert/strict";
import { Console } from "node:console";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const token = "private_tracking_token_storage_sentinel_0000000000";
const origin = "https://tracking-storage.example.test";
const secret = "private-tracking-storage-provider-secret";

/** @param {string} databaseUrl */
export async function produce(databaseUrl) {
  assert.match(
    databaseUrl,
    /^postgresql:\/\/tracking:tracking_fixture@127\.0\.0\.1:15432\/tracking$/u,
  );
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
        assert.ok(loaded.has(label) || loaded.size < 4096);
        loaded.set(
          label,
          createHash("sha256").update(readFileSync(filename)).digest("hex"),
        );
      }
      return result;
    },
  });

  /** @type {import("../../apps/backend/src/infrastructure/prisma/prisma-client.js").PlatformPrisma | undefined} */
  let prisma;
  /** @type {import("../../apps/backend/test/support/proof-dependencies.js").NestFastifyApplication | undefined} */
  let app;
  let providerFailures = 0;
  /** @type {unknown[]} */
  const commands = [];
  const provider = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += String(chunk);
      if (Buffer.byteLength(body) > 16384) request.destroy();
    });
    request.on("end", () => {
      try {
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/integrations/platform/v1/communications");
        assert.equal(request.headers.authorization, `Bearer ${secret}`);
        for (const key of ["traceparent", "tracestate", "baggage"])
          assert.equal(request.headers[key], undefined);
        const command = commandSchema.parse(JSON.parse(body));
        commands.push(command);
        if (command.operation === "tracking.resolve") {
          assert.equal(commands.length, 1);
          assert.equal(command.payload.token, token);
          response.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              contractVersion: "inside-communications-v1",
              status: "ok",
              safeUrl: `${origin}/materials/proof-material`,
            }),
          );
        } else {
          assert.equal(command.operation, "tracking.recordHit");
          if (command.operation !== "tracking.recordHit")
            throw new Error("closed operation");
          assert.equal(commands.length, 2);
          assert.equal(command.payload.token, token);
          assert.equal(command.operationId, command.payload.eventId);
          assert.equal(command.payload.traffic, "unknown");
          response.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              contractVersion: "inside-communications-v1",
              status: "ok",
              eventId: command.payload.eventId,
              outcome: "recorded",
            }),
          );
        }
      } catch {
        providerFailures++;
        response.writeHead(500).end();
      }
    });
  });
  /** @type {typeof import("../../apps/backend/src/modules/communications/communications-schema.generated.js").requestSchema} */
  let commandSchema;
  try {
    /** @type {typeof import("../../apps/backend/src/config/platform-config.js")} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled source, module bytes bound by the full runtime witness.
    const configuration = await import(
      pathToFileURL(
        resolve(root, "apps/backend/dist/config/platform-config.js"),
      ).href
    );
    // Narrow fixture call shape preserves the scripts compiler; the real decorated implementation remains backend-owned.
    /** @type {{createApiApplication(config?: import("../../apps/backend/src/config/platform-config.js").PlatformConfig, options?: import("../../apps/backend/test/support/proof-dependencies.js").NestApplicationOptions): Promise<import("../../apps/backend/test/support/proof-dependencies.js").NestFastifyApplication>}} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled source, module bytes bound by the full runtime witness.
    const entrypoint = await import(
      pathToFileURL(
        resolve(
          root,
          "apps/backend/dist/entrypoints/api/create-api-application.js",
        ),
      ).href
    );
    /** @type {typeof import("../../apps/backend/src/infrastructure/prisma/create-prisma-client.js")} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled source, module bytes bound by the full runtime witness.
    const persistence = await import(
      pathToFileURL(
        resolve(root, "apps/backend/dist/infrastructure/prisma/index.js"),
      ).href
    );
    /** @type {typeof import("../../apps/backend/src/migrations/index.js")} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled source, module bytes bound by the full runtime witness.
    const migrations = await import(
      pathToFileURL(resolve(root, "apps/backend/dist/migrations/index.js")).href
    );
    /** @type {typeof import("../../apps/backend/src/modules/communications/communications-schema.generated.js")} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled source, module bytes bound by the full runtime witness.
    const schema = await import(
      pathToFileURL(
        resolve(
          root,
          "apps/backend/dist/modules/communications/communications-schema.generated.js",
        ),
      ).href
    );
    commandSchema = schema.requestSchema;
    await migrations.migrateToLatest(databaseUrl);
    prisma = persistence.createPrismaClient(databaseUrl);
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    assert.ok(address !== null && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}`;
    const config = configuration.parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      LOGTO_ISSUER: origin + "/oidc",
      LOGTO_AUDIENCE: origin + "/api",
      LOGTO_JWKS_URL: endpoint + "/unused-jwks",
      IDENTITY_EMAIL_FINGERPRINT_KEY:
        "synthetic-tracking-storage-fingerprint-key",
      TELEGRAM_TRACKING_ORIGIN: origin,
      TELEGRAM_COMMUNICATIONS_ENDPOINT:
        endpoint + "/integrations/platform/v1/communications",
      TELEGRAM_COMMUNICATIONS_SECRET: secret,
      TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "private-tracking-author-secret",
      TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "tracking_storage_bot",
    });
    app = await entrypoint.createApiApplication(config, { logger: false });
    await app.listen(0, "127.0.0.1");
    const response = await fetch(
      (await app.getUrl()) + "/communications/tracking/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, traffic: "unknown" }),
        signal: AbortSignal.timeout(20000),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      kind: "resolved",
      safeUrl: origin + "/materials/proof-material",
    });
    const rows = await prisma.communicationTrackingHit.findMany();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row !== undefined);
    assert.equal(row.token, token);
    assert.equal(row.traffic, "unknown");
    assert.equal(typeof row.traceparent, "string");
    assert.match(row.traceparent ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
    const [, traceId, rootId] = (row.traceparent ?? "").split("-");
    const deadline = performance.now() + 20000;
    while (true) {
      const current = await prisma.communicationTrackingHit.findUniqueOrThrow({
        where: { eventId: row.eventId },
      });
      if (current.deliveredAt !== null) {
        assert.equal(current.traceparent, row.traceparent);
        assert.equal(current.eventId, row.eventId);
        break;
      }
      assert.ok(performance.now() < deadline);
      // deterministic-test-allow duration-wait: poll the committed deliveredAt fact; the real five-second production timer owns admission.
      await new Promise((resume) => setTimeout(resume, 50));
    }
    assert.equal(providerFailures, 0);
    assert.equal(commands.length, 2);
    const delivered = commandSchema.parse(commands[1]);
    assert.equal(delivered.operation, "tracking.recordHit");
    if (delivered.operation !== "tracking.recordHit")
      throw new Error("closed operation");
    assert.equal(delivered.payload.eventId, row.eventId);
    assert.equal(delivered.payload.occurredAt, row.occurredAt.toISOString());
    // Normal API lifecycle drains the real pump and flushes its SDK while Alloy remains alive.
    await app.close();
    app = undefined;
    await prisma.$disconnect();
    prisma = undefined;
    const modules = [...loaded]
      .sort()
      .map(([path, sha256]) => ({ path, sha256 }));
    return {
      schema: 1,
      trace_id: traceId,
      root_id: rootId,
      provider_requests: 2,
      business: "passed",
      persisted_carrier: "passed",
      native_timer: "passed",
      sdk_shutdown: "passed",
      runtime_module_groups: Array.from(
        { length: Math.ceil(modules.length / 512) },
        (_, index) => modules.slice(index * 512, (index + 1) * 512),
      ),
    };
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        provider.closeAllConnections();
        if (provider.listening)
          await new Promise((done, reject) =>
            provider.close((error) =>
              error === undefined ? done(undefined) : reject(error),
            ),
          );
        hooks.deregister();
      }
    }
  }
}

/**
 * The isolated child reserves stdout for its single strict IPC document.
 * Production writeLog uses the global Console independently of Nest's logger option.
 * Python owns/discards stderr; no application diagnostic bytes enter public artifacts.
 * @param {() => Promise<unknown>} work
 * @param {import("node:stream").Writable} diagnostics
 */
export async function writeProducerWitness(work, diagnostics = process.stderr) {
  const original = globalThis.console;
  globalThis.console = new Console({
    stdout: diagnostics,
    stderr: diagnostics,
  });
  try {
    process.stdout.write(JSON.stringify(await work()));
  } finally {
    globalThis.console = original;
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // This dedicated CLI owns Console until process exit, including late shutdown callbacks.
  // writeProducerWitness restores this private Console, never a stdout-backed application sink.
  globalThis.console = new Console({
    stdout: process.stderr,
    stderr: process.stderr,
  });
  try {
    await writeProducerWitness(() =>
      produce(
        "postgresql://tracking:tracking_fixture@127.0.0.1:15432/tracking",
      ),
    );
  } catch {
    process.stderr.write("tracking-storage-producer: closed fixture failure\n");
    process.exitCode = 1;
  }
}
