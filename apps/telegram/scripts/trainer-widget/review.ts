import "reflect-metadata";

import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { Trainer } from "../../src/modules/trainer/trainer.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import { systemClock } from "../../src/shared/clock.js";
import { syntheticTrainerBank } from "../../test/support/synthetic-trainer-bank.js";
import { reviewPage, widgetPage } from "./review-page.js";
import { permitsReviewPost, reviewDatabaseUrl } from "./review-settings.js";

// This tool accepts no database URL or bot token. Every invocation owns a new disposable
// Compose project; only that project is removed at shutdown. The shared stand is never used.
const run = promisify(execFile);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const receiptDirectory = new URL(
  "../../../../.reports/trainer-review/",
  import.meta.url,
);
const project = `trainer-review-${randomUUID().slice(0, 8)}`;
const receipt = new URL(`${project}.json`, receiptDirectory);
const compose = async (...args: string[]) =>
  run("docker", ["compose", "-f", "apps/telegram/compose.yaml", ...args], {
    cwd: root,
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: project,
      TELEGRAM_POSTGRES_PORT: "0",
      TELEGRAM_AMQP_PORT: "0",
      TELEGRAM_MANAGEMENT_PORT: "0",
    },
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });

let database: ReturnType<typeof createDatabase> | undefined;
let server: ReturnType<typeof createServer> | undefined;
let resolveStop!: () => void;
const cancellation = new AbortController();
const stop = new Promise<void>((resolve) => {
  resolveStop = resolve;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    cancellation.abort();
    resolveStop();
  });

try {
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    receipt,
    JSON.stringify({ project, pid: process.pid }, null, 2),
  );
  console.log(`Preparing disposable PostgreSQL: ${project}`);
  await compose("ps");
  await compose("up", "-d", "--wait", "postgres");
  cancellation.signal.throwIfAborted();
  const { stdout } = await compose("port", "postgres", "5432");
  const databaseName = project.replaceAll("-", "_");
  // A remote Docker context must never make us migrate an unrelated local PostgreSQL.
  // Create the nonce database inside our own container before connecting through its port.
  await compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "inside",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${databaseName}"`,
  );
  database = createDatabase(reviewDatabaseUrl(stdout, databaseName));
  await migrateToLatest(database);
  const bank = await new TrainerBank(database, systemClock).import(
    syntheticTrainerBank({ topics: 9, questionsPerTopic: 12 }),
    true,
  );
  if (bank.status !== "imported") throw new Error("Synthetic Bank rejected");
  let person = 0;
  let update = 0;
  let result = "";
  let initialState = "";
  const trainer = new Trainer(database, {
    sendWidget: (message) => {
      result = message.chatData;
      return Promise.resolve({ kind: "delivered", providerMessageId: "1" });
    },
    answerWidgetQuery: (answer) => {
      result = answer.data;
      return Promise.resolve();
    },
  });
  const contact = () => ({
    botIdentity: "trainer-review",
    telegramUserId: String(person),
    privateChatId: String(person),
    updateId: String(++update),
    observedAt: systemClock.now(),
    profile: { displayName: `Участник ${String(person)}`, username: null },
  });
  const reset = async () => {
    person += 1;
    const at = systemClock.now();
    await database
      ?.insertInto("bot_contacts")
      .values({
        bot_identity: "trainer-review",
        telegram_user_id: String(person),
        private_chat_id: String(person),
        contactability: "reachable",
        first_started_at: at,
        last_started_at: at,
        updated_at: at,
      })
      .execute();
  };
  const tap = async (data: string) => {
    const sender = contact();
    await trainer.answer({ contact: sender, queryId: sender.updateId, data });
    return result;
  };
  let origin = "";
  // Serialize requests so a second browser action never reads another captured answer.
  let previous = Promise.resolve();
  server = createServer((request, response) => {
    previous = previous
      .then(async () => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
        if (`http://${request.headers.host}` !== origin) {
          response.writeHead(403).end();
          return;
        }
        const url = new URL(request.url ?? "/", origin);
        if (request.method === "GET" && url.pathname === "/favicon.ico") {
          response.writeHead(204).end();
          return;
        }
        if (request.method === "GET" && url.pathname === "/") {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(reviewPage);
          return;
        }
        if (
          request.method === "GET" &&
          url.pathname === "/widget" &&
          person > 0
        ) {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          const initial = initialState;
          const { TRAINER_WIDGET_HTML } =
            await import("../../src/modules/trainer/widget/trainer-widget-html.generated.js");
          response.end(
            widgetPage(
              TRAINER_WIDGET_HTML,
              initial,
              url.searchParams.get("theme") === "dark",
            ),
          );
          return;
        }
        if (
          request.method !== "POST" ||
          !permitsReviewPost(
            request.headers.origin,
            request.headers["content-type"],
            origin,
          )
        ) {
          response.writeHead(403).end();
          return;
        }
        let body = "";
        for await (const chunk of request) {
          body += String(chunk);
          if (Buffer.byteLength(body) > 1024) {
            response.writeHead(413).end();
            return;
          }
        }
        if (url.pathname === "/api/reset") {
          await reset();
          initialState = await tap("h");
          response.end("{}");
          return;
        }
        const parsed = z
          .object({
            data: z
              .string()
              .min(1)
              .refine((text) => Buffer.byteLength(text) <= 64),
          })
          .safeParse(JSON.parse(body));
        if (url.pathname !== "/api/tap" || !parsed.success || person === 0) {
          response.writeHead(400).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.end(await tap(parsed.data.data));
      })
      .catch((error: unknown) => {
        console.error(
          "Review request failed",
          error instanceof Error ? error.message : "unknown",
        );
        if (!response.headersSent) response.writeHead(500);
        response.end("Review request failed");
      });
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Review server has no TCP address");
  origin = `http://127.0.0.1:${String(address.port)}`;
  await writeFile(
    receipt,
    JSON.stringify({ project, pid: process.pid, url: origin }, null, 2),
  );
  console.log(`Trainer review: ${origin}`);
  console.log(`PID: ${String(process.pid)}; PostgreSQL project: ${project}`);
  console.log("Stop with Ctrl+C; its PostgreSQL volume will be removed.");
  await stop;
} finally {
  if (server)
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  await database?.destroy();
  await compose("down", "--volumes");
  await rm(receipt, { force: true });
}
