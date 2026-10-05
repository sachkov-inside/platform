import { hasText } from "../src/shared/text.js";
import "reflect-metadata";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import { loadApplicationConfig } from "../src/config/application-config.js";
import { createDatabase } from "../src/database/create-database.js";
import { migrateToLatest } from "../src/database/migrator.js";
import {
  TELEGRAM_MEMBERSHIP,
  type TelegramChatMemberResult,
  type TelegramMembership,
} from "../src/modules/membership-evidence/telegram-membership.js";
import {
  localProofDatabaseUrl,
  loopbackHttpUrl,
} from "./conformance-safety.js";

const databaseUrl = localProofDatabaseUrl(
  required("DATABASE_URL"),
  "DATABASE_URL",
);
const evidenceUrl = loopbackHttpUrl(
  required("CONFORMANCE_PLATFORM_EVIDENCE_URL"),
  "CONFORMANCE_PLATFORM_EVIDENCE_URL",
);
const controlSecret = required("CONFORMANCE_CONTROL_SECRET");
const appPort = port("CONFORMANCE_TELEGRAM_PORT", 44_102);
const controlPort = port("CONFORMANCE_TELEGRAM_CONTROL_PORT", 44_103);

class ControlledTelegramMembership implements TelegramMembership {
  calls = 0;
  botState: "administrator" | "member" | "unavailable" = "administrator";
  subjectState: "left" | "member" | "unavailable" = "member";

  getBotChatMember(): Promise<TelegramChatMemberResult> {
    this.calls += 1;
    return Promise.resolve(result(this.botState));
  }

  getChatMember(): Promise<TelegramChatMemberResult> {
    this.calls += 1;
    return Promise.resolve(result(this.subjectState));
  }
}

const config = loadApplicationConfig({
  DATABASE_URL: databaseUrl,
  TELEGRAM_BOT_IDENTITY: "inside-proof",
  TELEGRAM_BOT_TOKEN: "synthetic-proof-token",
  TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
  TELEGRAM_DELIVERY_MODE: "disabled",
  PLATFORM_EVIDENCE_DELIVERY_MODE: "live",
  HOST: "127.0.0.1",
  TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic link receipt",
  TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
  TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic non-member",
  TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
  TELEGRAM_MEMBERSHIP_MODE: "live",
  TELEGRAM_MEMBERSHIP_RECONCILIATION_CADENCE_MS: "30000",
  PLATFORM_EVIDENCE_DELIVERY_SECRET: required("CONFORMANCE_EVIDENCE_SECRET"),
  PLATFORM_EVIDENCE_DELIVERY_URL: evidenceUrl,
  PLATFORM_INTEGRATION_SECRET: required("CONFORMANCE_LINK_SECRET"),
  PORT: String(appPort),
  TELEGRAM_WEBHOOK_SECRET: required("CONFORMANCE_WEBHOOK_SECRET"),
  TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
  WORKERS_ENABLED: "true",
});

const migrationDatabase = createDatabase(databaseUrl);
await migrateToLatest(migrationDatabase);
await migrationDatabase.destroy();

const membership = new ControlledTelegramMembership();
const module = await Test.createTestingModule({
  imports: [AppModule.register(config)],
})
  .overrideProvider(TELEGRAM_MEMBERSHIP)
  .useValue(membership)
  .compile();
const application = module.createNestApplication<NestFastifyApplication>(
  new FastifyAdapter({ bodyLimit: 1024 * 1024 }),
);
await application.listen(appPort, "127.0.0.1");

const control = createServer((request, response) => {
  handleControl(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end(JSON.stringify({ error: "internal" }));
  });
});
async function handleControl(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  response.setHeader("content-type", "application/json");
  if (request.headers.authorization !== `Bearer ${controlSecret}`) {
    response.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (request.method === "GET" && request.url === "/state") {
    response.end(
      JSON.stringify({
        botState: membership.botState,
        calls: membership.calls,
        subjectState: membership.subjectState,
      }),
    );
    return;
  }
  if (request.method === "POST" && request.url === "/state") {
    const body = await readBody(request);
    if (isBotState(body["botState"])) {
      membership.botState = body["botState"];
    }
    if (isSubjectState(body["subjectState"])) {
      membership.subjectState = body["subjectState"];
    }
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
}
await new Promise<void>((resolve) =>
  control.listen(controlPort, "127.0.0.1", resolve),
);

process.stdout.write(
  `Telegram conformance provider listening on 127.0.0.1:${String(appPort)}; control 127.0.0.1:${String(controlPort)}\n`,
);

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve) => control.close(() => resolve()));
  await application.close();
}

process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));

function result(
  state: "administrator" | "left" | "member" | "unavailable",
): TelegramChatMemberResult {
  return state === "unavailable"
    ? { diagnosticCode: "controlled_provider_outage", kind: "unavailable" }
    : { kind: "observed", value: { status: state } };
}

function isBotState(
  value: unknown,
): value is ControlledTelegramMembership["botState"] {
  return (
    value === "administrator" || value === "member" || value === "unavailable"
  );
}

function isSubjectState(
  value: unknown,
): value is ControlledTelegramMembership["subjectState"] {
  return value === "left" || value === "member" || value === "unavailable";
}

async function readBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Control body must be an object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid port`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!hasText(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
}
