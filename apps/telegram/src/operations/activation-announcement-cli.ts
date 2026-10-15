import "../config/load-environment.js";
import { readFileSync } from "node:fs";
import { Api } from "grammy";
import { hasText } from "../shared/text.js";
import { GrammyMessagesAdapter } from "../adapters/telegram/grammy-messages.adapter.js";
import { HttpActivationPlatform } from "../adapters/platform/http-activation-platform.adapter.js";
import { loadApplicationConfig } from "../config/application-config.js";
import { createDatabase } from "../database/create-database.js";
import { PostgresAnnouncementDeliveries } from "../modules/subscription-activation/announcement-deliveries.js";
import {
  announceActivation,
  type ActivationAnnouncementInput,
} from "../modules/subscription-activation/activation-announcement.js";

const mode = process.argv[2];
if (
  !["--preview", "--send"].includes(mode ?? "") ||
  process.argv.length !== 3 ||
  process.stdin.isTTY
) {
  process.stderr.write(
    "Use --preview or --send with the owner announcement JSON on stdin.\n",
  );
  process.exitCode = 1;
} else {
  let db: ReturnType<typeof createDatabase> | undefined;
  try {
    const config = loadApplicationConfig(process.env);
    if (
      !hasText(config.botToken) ||
      !config.activation ||
      !hasText(process.env["DATABASE_URL"])
    )
      throw new Error("Configuration required");
    const input = readAnnouncement(
      JSON.parse(readFileSync(0, "utf8")),
      config.activation,
      mode === "--send",
    );
    db = createDatabase(process.env["DATABASE_URL"]);
    const api = new Api(config.botToken, { timeoutSeconds: 10 });
    const messages = new GrammyMessagesAdapter(config.botToken, api);
    const result = await announceActivation(
      input,
      {
        botUsername: async () => (await api.getMe()).username,
        privateChat: async (chatId) =>
          (await api.getChat(Number(chatId))).type === "private",
        sendText: (message) => messages.sendText(message),
      },
      new HttpActivationPlatform(
        config.activation.endpoint,
        config.activation.secret,
      ),
      new PostgresAnnouncementDeliveries(db),
    );
    // Output contains the sample and source, but no private chat id or credentials.
    process.stdout.write(
      JSON.stringify({ ...result, sourceRef: input.sourceRef }) + "\n",
    );
    if (result.status !== "ready" && result.status !== "sent")
      process.exitCode = 2;
  } catch {
    process.stderr.write(
      "Activation announcement stopped; no token or chat id printed. A send may have an unknown outcome; inspect the private chat before another operation.\n",
    );
    process.exitCode = 1;
  } finally {
    await db?.destroy();
  }
}

function readAnnouncement(
  value: unknown,
  activation: ActivationAnnouncementInput["activation"],
  send: boolean,
): ActivationAnnouncementInput {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid announcement");
  const fields = new Map<string, unknown>(Object.entries(value));
  const keys = [
    "code",
    "operationId",
    "privateChatId",
    "productId",
    "sourceRef",
    "text",
  ];
  if ([...fields.keys()].sort().join(",") !== keys.join(","))
    throw new Error("Invalid announcement");
  const text = (name: string): string => {
    const field = fields.get(name);
    if (typeof field !== "string") throw new Error("Invalid announcement");
    return field;
  };
  return {
    activation,
    send,
    code: text("code"),
    operationId: text("operationId"),
    privateChatId: text("privateChatId"),
    productId: text("productId"),
    sourceRef: text("sourceRef"),
    text: text("text"),
  };
}
