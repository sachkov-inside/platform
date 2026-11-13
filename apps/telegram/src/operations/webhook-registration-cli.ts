import { hasText } from "../shared/text.js";
import "../config/load-environment.js";

import {
  planWebhookRegistration,
  webhookRegistrationApplied,
} from "./webhook-registration.js";
import { callBotApi } from "./telegram-bot-api.js";

const mode = process.argv[2];
const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
const secret = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim();
const expectedUrl = process.env["TELEGRAM_WEBHOOK_URL"]?.trim();

if (
  !["--preview", "--apply"].includes(mode ?? "") ||
  !hasText(token) ||
  !hasText(secret) ||
  !hasText(expectedUrl)
) {
  process.stderr.write(
    "Use --preview or --apply with TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_WEBHOOK_URL in the environment.\n",
  );
  process.exitCode = 1;
} else {
  try {
    const plan = planWebhookRegistration(
      await callBotApi(token, "getWebhookInfo"),
      expectedUrl,
      secret,
    );
    if (plan.kind === "refused") {
      write({ status: "refused", reason: plan.reason });
      process.exitCode = 2;
    } else if (plan.kind === "current") {
      write({ status: "current", ...plan.summary });
    } else if (mode === "--preview") {
      write({ status: "ready", ...plan.summary });
    } else {
      try {
        await callBotApi(token, "setWebhook", plan.request);
      } catch {
        // A lost response is resolved by the read-back below, never by a blind repeat.
      }
      const applied = webhookRegistrationApplied(
        plan.request,
        await callBotApi(token, "getWebhookInfo"),
      );
      write({ status: applied ? "applied" : "not_confirmed", ...plan.summary });
      if (!applied) process.exitCode = 2;
    }
  } catch {
    process.stderr.write(
      "Webhook registration stopped; no token, secret, URL or address printed.\n",
    );
    process.exitCode = 1;
  }
}

function write(result: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
