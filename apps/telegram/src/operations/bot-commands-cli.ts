import { hasText } from "../shared/text.js";
import "../config/load-environment.js";

import { botCommandsCurrent, planBotCommands } from "./bot-commands.js";

const mode = process.argv[2];
const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
const ownerChatId = process.env["TELEGRAM_OWNER_CHAT_ID"]?.trim();

if (
  !["--preview", "--apply"].includes(mode ?? "") ||
  !hasText(token) ||
  !hasText(ownerChatId)
) {
  process.stderr.write(
    "Use --preview or --apply with TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID in the environment.\n",
  );
  process.exitCode = 1;
} else {
  try {
    for (const target of planBotCommands(ownerChatId)) {
      const before = await botApi(token, "getMyCommands", {
        scope: target.scope,
      });
      if (botCommandsCurrent(target, before)) {
        write({ audience: target.audience, status: "current" });
        continue;
      }
      if (mode === "--preview") {
        write({
          audience: target.audience,
          status: "ready",
          commands: target.commands,
        });
        continue;
      }
      try {
        await botApi(token, "setMyCommands", {
          scope: target.scope,
          commands: target.commands,
        });
      } catch {
        // A lost response is resolved by the read-back below, never by a blind repeat.
      }
      const applied = botCommandsCurrent(
        target,
        await botApi(token, "getMyCommands", { scope: target.scope }),
      );
      write({
        audience: target.audience,
        status: applied ? "applied" : "not_confirmed",
      });
      if (!applied) process.exitCode = 2;
    }
  } catch {
    process.stderr.write(
      "Bot command setup stopped; no token or chat ID printed.\n",
    );
    process.exitCode = 1;
  }
}

function write(result: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function botApi(
  botToken: string,
  method: "getMyCommands" | "setMyCommands",
  body: object,
): Promise<unknown> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload: unknown = await response.json();
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    (payload as { ok?: unknown }).ok !== true
  )
    throw new Error("Telegram Bot API rejected the request");
  return (payload as { result?: unknown }).result;
}
