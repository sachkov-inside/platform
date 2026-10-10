import { probeBotContactStorage } from "../modules/bot-contacts/contact-diagnostics.js";
import { probeMembershipStorage } from "../modules/membership-evidence/membership-diagnostics.js";
import { probeIdentityStorage } from "../modules/identity-linking/identity-diagnostics.js";
import { hasText } from "../shared/text.js";
import { Client } from "pg";

const database = new Client({
  connectionString: process.env["DATABASE_URL"],
  connectionTimeoutMillis: 2000,
  query_timeout: 2000,
  statement_timeout: 2000,
});

try {
  if (!hasText(process.env["DATABASE_URL"])) {
    throw new Error("Missing database configuration");
  }
  const response = await fetch(
    `http://127.0.0.1:${process.env["PORT"] ?? "3002"}/integrations/platform/v1/identity-links`,
    { method: "POST", signal: AbortSignal.timeout(2000) },
  );
  if (response.status !== 401) {
    throw new Error("Application authentication is not ready");
  }
  await database.connect();
  await probeBotContactStorage(database);
  await probeMembershipStorage(database);
  await probeIdentityStorage(database);
} catch {
  console.error("Telegram application or database is not ready");
  process.exitCode = 1;
} finally {
  await database.end();
}
