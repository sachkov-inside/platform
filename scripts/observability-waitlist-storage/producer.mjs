// @ts-check
// Genuine loopback API -> persisted carrier -> production timer, with owned provider/PG.
import { writeProducerWitness } from "../observability-tracking-storage/producer.mjs";
import assert from "node:assert/strict";
import { Console } from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "https://waitlist-storage.example.test";
const secret = "private-waitlist-storage-provider-secret";

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
        assert.equal(commands.length, 1);
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify({ eventId: command.eventId, status: "accepted" }),
          );
      } catch {
        providerFailures++;
        response.writeHead(500).end();
      }
    });
  });
  /** @type {typeof import("../../docs/contracts/runtime/waitlist-confirmation.js").waitlistConfirmationSchema} */
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
    /** @type {typeof import("../../docs/contracts/runtime/waitlist-confirmation.js")} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled source, module bytes bound by the full runtime witness.
    const schema = await import(
      pathToFileURL(
        resolve(root, "docs/contracts/dist/runtime/waitlist-confirmation.js"),
      ).href
    );
    commandSchema = schema.waitlistConfirmationSchema;
    await migrations.migrateToLatest(databaseUrl);
    prisma = persistence.createPrismaClient(databaseUrl);
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    assert.ok(address !== null && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}`;
    /** @type {{bootstrapOwnerAccount: typeof import("../../apps/backend/src/modules/accounts/features/bootstrap-owner-account/bootstrap-owner-account.js").bootstrapOwnerAccount}} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed compiled owning module, independently hashed.
    const accounts = await import(
      pathToFileURL(
        resolve(root, "apps/backend/dist/modules/accounts/index.js"),
      ).href
    );
    /** @type {typeof import("../../apps/backend/test/support/proof-dependencies.js").jose} */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Pinned backend dependency, independently hashed.
    const jose = await import(
      pathToFileURL(
        resolve(root, "apps/backend/node_modules/jose/dist/webapi/index.js"),
      ).href
    );
    const pair = await jose.generateKeyPair("ES384");
    const jwk = {
      ...(await jose.exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "waitlist-proof",
    };
    const issuer = createServer((_request, response) =>
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ keys: [jwk] })),
    );
    try {
      issuer.listen(0, "127.0.0.1");
      await once(issuer, "listening");
      const issuerAddress = issuer.address();
      assert.ok(issuerAddress !== null && typeof issuerAddress !== "string");
      const accountId = (
        await accounts.bootstrapOwnerAccount(
          prisma,
          { issuer: origin, subject: "private-member" },
          "materials:manage",
        )
      ).accountId;
      const productId = randomUUID(),
        intakeId = randomUUID();
      await prisma.product.create({
        data: { id: productId, slug: "waitlist-storage", name: "Waitlist" },
      });
      await prisma.productWaitlistIntake.create({
        data: { id: intakeId, productId, name: "Next", accepting: true },
      });
      await prisma.telegramAccountLinkState.create({
        data: {
          accountId,
          linkRef: randomUUID(),
          revision: 1,
          principalRef: "private-account-ref",
          identityRef: "private-identity-ref",
          updatedAt: new Date("2026-10-07T09:00:00Z"),
        },
      });
      const config = configuration.parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        LOGTO_ISSUER: origin,
        LOGTO_AUDIENCE: origin + "/api",
        LOGTO_JWKS_URL: `http://127.0.0.1:${issuerAddress.port}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "synthetic-waitlist-fingerprint-key",
        TELEGRAM_COMMUNICATIONS_ENDPOINT:
          endpoint + "/integrations/platform/v1/communications",
        TELEGRAM_COMMUNICATIONS_SECRET: secret,
        TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "waitlist_storage_bot",
      });
      // Existing missing-configuration admission makes the producer-only lifecycle perform zero provider I/O.
      // The restart enables the ordinary relay, avoiding any race against its five-second timer.
      const { communications, ...sourceConfig } = config;
      assert.ok(communications !== undefined);
      app = await entrypoint.createApiApplication(sourceConfig, {
        logger: false,
      });
      await app.listen(0, "127.0.0.1");
      // deterministic-test-allow wall-clock: A fresh signed JWT uses the same real clock as the production verifier.
      const now = Math.floor(Date.now() / 1000);
      const token = await new jose.SignJWT({})
        .setProtectedHeader({ alg: "ES384", kid: "waitlist-proof" })
        .setIssuer(origin)
        .setAudience(origin + "/api")
        .setSubject("private-member")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(pair.privateKey);
      const response = await fetch(
        (await app.getUrl()) + "/product-waitlists/join",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            intakeId,
            operationId: randomUUID(),
            source: null,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        intakeId,
        name: "Next",
        active: true,
      });
      const rows = await prisma.productWaitlistConfirmation.findMany();
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.ok(row !== undefined);
      assert.match(row.traceparent ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
      const [, traceId, rootId] = (row.traceparent ?? "").split("-");
      assert.equal(row.completedAt, null);
      assert.equal(commands.length, 0);
      // Reconstruct only from the committed row in a fresh API lifecycle, never the preceding HTTP ambient context.
      await app.close();
      app = undefined;
      assert.equal(commands.length, 0);
      app = await entrypoint.createApiApplication(config, { logger: false });
      await app.listen(0, "127.0.0.1");
      const deadline = performance.now() + 20000;
      while (true) {
        const current =
          await prisma.productWaitlistConfirmation.findUniqueOrThrow({
            where: { eventId: row.eventId },
          });
        if (current.completedAt !== null) {
          assert.equal(current.traceparent, row.traceparent);
          break;
        }
        assert.ok(performance.now() < deadline);
        // deterministic-test-allow duration-wait: Poll the durable receipt fact; the existing real five-second timer owns dispatch.
        await new Promise((resume) => setTimeout(resume, 50));
      }
      assert.equal(providerFailures, 0);
      assert.equal(commands.length, 1);
      assert.equal(commandSchema.parse(commands[0]).eventId, row.eventId);
      assert.equal(
        (
          await prisma.productWaitlistMembership.findUniqueOrThrow({
            where: { intakeId_accountId: { intakeId, accountId } },
          })
        ).active,
        true,
      );
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
        provider_requests: 1,
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
      issuer.closeAllConnections();
      if (issuer.listening)
        await new Promise((done, reject) =>
          issuer.close((error) =>
            error === undefined ? done(undefined) : reject(error),
          ),
        );
    }
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
    process.stderr.write("waitlist-storage-producer: closed fixture failure\n");
    process.exitCode = 1;
  }
}
