import "../config/load-environment.js";
import { hasText } from "../shared/text.js";
import { createDatabase } from "../database/create-database.js";
import { GrammyMembershipAdapter } from "../adapters/telegram/grammy-membership.adapter.js";
import { runGroupMembersReport } from "./group-members-report-command.js";

const output = process.argv[2];
const databaseUrl = process.env["DATABASE_URL"];
const botIdentity = process.env["TELEGRAM_BOT_IDENTITY"];
const botToken = process.env["TELEGRAM_BOT_TOKEN"];
const chatId = process.env["TELEGRAM_CANONICAL_CHAT_ID"];
const endpoint = process.env["PLATFORM_GROUP_REPORT_URL"];
const operatorToken = process.env["PLATFORM_OPERATOR_TOKEN"];

if (
  process.argv.length !== 3 ||
  !hasText(output) ||
  !hasText(databaseUrl) ||
  !hasText(botIdentity) ||
  !hasText(botToken) ||
  !hasText(chatId) ||
  !hasText(endpoint) ||
  !hasText(operatorToken)
) {
  process.stderr.write(
    "Provide an output file and DATABASE_URL, TELEGRAM_BOT_IDENTITY, TELEGRAM_BOT_TOKEN, TELEGRAM_CANONICAL_CHAT_ID, PLATFORM_GROUP_REPORT_URL, PLATFORM_OPERATOR_TOKEN.\n",
  );
  process.exitCode = 1;
} else {
  const database = createDatabase(databaseUrl);
  try {
    await runGroupMembersReport({
      database,
      botIdentity,
      canonicalChatId: chatId,
      telegram: new GrammyMembershipAdapter(botToken),
      platformEndpoint: endpoint,
      operatorToken,
      output,
    });
    process.stdout.write("Group report saved; coverage is known IDs only.\n");
  } catch {
    process.stderr.write(
      "Group report failed; no identifiers or credentials printed.\n",
    );
    process.exitCode = 1;
  } finally {
    try {
      await database.destroy();
    } catch {
      process.stderr.write("Group report database shutdown failed.\n");
      process.exitCode = 1;
    }
  }
}
