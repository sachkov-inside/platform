// deterministic-test-allow unit-io: real built main, owned PostgreSQL migration lock and loopback OTLP; root supervisor and finally own all cleanup. Native execution requires hosted services.
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import { launchTelegramMain } from "../support/telegram-main-process.js";
import { required } from "../support/required.js";

// Pinned Kysely0.29.6 PostgresAdapter's session migration lock, not a business lease.
const MIGRATION_LOCK = "3853314791062309107";
const FACT_BUDGET_MS = 10_000;

for (const phase of ["ready", "migration_wait"] as const)
  it(`real main SIGTERM closes owned PostgreSQL sessions (${phase})`, async () => {
    let observer: Pool | undefined;
    let directory: string | undefined;
    let locked: PoolClient | undefined;
    let runtime: ReturnType<typeof launchTelegramMain> | undefined;
    let exportsSeen = 0;
    const receiver = createServer((request, response) => {
      request.resume();
      request.once("end", () => {
        if (request.method === "POST" && request.url === "/v1/metrics")
          exportsSeen += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    const failures: unknown[] = [];
    let stage = "acquisition";
    let firstFailureStage: string | undefined;
    let cleanupFailures = 0;
    const cleanup = async (action: () => Promise<unknown>): Promise<void> => {
      try {
        await action();
      } catch (error: unknown) {
        failures.push(error);
        firstFailureStage ??= stage;
        cleanupFailures += 1;
      }
    };
    try {
      const databaseUrl = new URL(required(process.env["DATABASE_URL"]));
      if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname))
        throw new Error(
          "Managed main proof requires owned loopback PostgreSQL",
        );
      const applicationName = `telegram-main-lifecycle-${phase}`;
      databaseUrl.searchParams.set("application_name", applicationName);
      const nativeObserver = new Pool({
        connectionString: required(process.env["DATABASE_URL"]),
        max: 2,
      });
      observer = nativeObserver;
      const ownedDirectory = await mkdtemp(
        join(tmpdir(), "telegram-main-lifecycle-"),
      );
      directory = ownedDirectory;
      receiver.listen(0, "127.0.0.1");
      await once(receiver, "listening");
      const address = receiver.address();
      if (address === null || typeof address === "string")
        throw new Error("Owned OTLP receiver unavailable");
      if (phase === "migration_wait") {
        locked = await nativeObserver.connect();
        await locked.query("select pg_advisory_lock($1::bigint)", [
          MIGRATION_LOCK,
        ]);
      }
      runtime = launchTelegramMain({
        entrypoint: new URL("../../dist/main.js", import.meta.url),
        environment: {
          NODE_ENV: "test",
          ENV_FILE: join(ownedDirectory, "absent.env"),
          DATABASE_URL: databaseUrl.toString(),
          HOST: "127.0.0.1",
          PORT: "3002",
          TELEGRAM_BOT_IDENTITY: "synthetic",
          TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_00000000",
          PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_0000000",
          WORKERS_ENABLED: "false",
          TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
          TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
          TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
          TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic nonmember",
          TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
          TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
          INSIDE_OTEL_ENABLED: "true",
          INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
        },
        readiness: "Inside Telegram listening on 127.0.0.1:3002",
      });
      const child = runtime;
      await child.identity;
      let listened = false;
      void child.ready.then(
        () => {
          listened = true;
        },
        () => undefined,
      );
      stage = phase;
      if (phase === "ready") await child.ready;
      else {
        await vi.waitFor(
          async () => {
            const waiting = await nativeObserver.query<{ count: number }>(
              "select count(*)::int as count from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and wait_event='advisory'",
              [applicationName],
            );
            expect(waiting.rows[0]?.count).toBe(1);
          },
          { timeout: FACT_BUDGET_MS },
        );
      }
      stage = "signal";
      child.signal();
      if (phase === "migration_wait") {
        child.signal();
        // This is an observed snapshot while genuine work is held, not a quiescence verdict.
        expect(child.hasExited()).toBe(false);
        expect(listened).toBe(false);
        await required(locked).query("select pg_advisory_unlock($1::bigint)", [
          MIGRATION_LOCK,
        ]);
        const held = required(locked);
        locked = undefined;
        held.release();
      }
      stage = "exit";
      await vi.waitFor(() => expect(child.hasExited()).toBe(true), {
        timeout: FACT_BUDGET_MS,
      });
      expect(await child.exited).toEqual([0, null]);
      expect(child.outputOverflow()).toBe(false);
      if (phase === "migration_wait") expect(listened).toBe(false);
      // Periodic exports are permitted. This proves native SDK traffic, not SDK shutdown order.
      expect(exportsSeen).toBeGreaterThan(0);
      stage = "sessions";
      const remaining = await nativeObserver.query<{ count: number }>(
        "select count(*)::int as count from pg_stat_activity where application_name=$1",
        [applicationName],
      );
      expect(remaining.rows[0]?.count).toBe(0);
    } catch (error: unknown) {
      failures.push(error);
      firstFailureStage ??= stage;
    } finally {
      stage = "cleanup_lock";
      if (locked !== undefined) {
        const held = locked;
        await cleanup(async () => {
          await held.query("select pg_advisory_unlock($1::bigint)", [
            MIGRATION_LOCK,
          ]);
        });
        await cleanup(() => Promise.resolve(held.release()));
      }
      stage = "cleanup_child";
      await cleanup(async () => {
        await runtime?.stop();
      });
      stage = "cleanup_database";
      await cleanup(async () => {
        await observer?.end();
      });
      stage = "cleanup_receiver";
      await cleanup(
        () =>
          new Promise<void>((resolve, reject) =>
            receiver.close((error) =>
              error === undefined ? resolve() : reject(error),
            ),
          ),
      );
      stage = "cleanup_directory";
      if (directory !== undefined) {
        const ownedDirectory = directory;
        await cleanup(() =>
          rm(ownedDirectory, { recursive: true, force: true }),
        );
      }
    }
    // Original errors stay local. Public CI receives only closed stage/count metadata.
    if (failures.length > 0)
      throw new Error(
        JSON.stringify({
          proof: "telegram_main_lifecycle",
          outcome: "failed",
          stage: firstFailureStage,
          failures: failures.length,
          cleanup_failures: cleanupFailures,
        }),
      );
  }, 25_000);
