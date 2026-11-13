import { z } from "zod";

/** How long an operator command waits for one Bot API answer. */
const BOT_API_TIMEOUT_MS = 10_000;

/** Bot API methods that the owner's one-off commands call. */
export type OperatorBotApiMethod =
  "getWebhookInfo" | "setWebhook" | "getMyCommands" | "setMyCommands";

const botApiAnswer = z.object({ ok: z.literal(true), result: z.unknown() });

/**
 * One Bot API call of an operator command. The token travels only in the request URL and is
 * never printed; a rejected or unreadable answer throws without its body.
 */
export async function callBotApi(
  botToken: string,
  method: OperatorBotApiMethod,
  body: object = {},
): Promise<unknown> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(BOT_API_TIMEOUT_MS),
    },
  );
  const payload: unknown = await response.json();
  const answer = botApiAnswer.safeParse(payload);
  if (!response.ok || !answer.success)
    throw new Error("Telegram Bot API rejected the request");
  return answer.data.result;
}
