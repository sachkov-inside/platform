import { z } from "zod";

/** One entry of the Telegram command menu, as the Bot API stores it. */
export interface BotCommand {
  readonly command: string;
  readonly description: string;
}

/** Where a command list is shown: every private chat, or the owner's own chat. */
export interface BotCommandsTarget {
  readonly audience: "private" | "owner";
  readonly scope:
    | { readonly type: "all_private_chats" }
    | { readonly type: "chat"; readonly chat_id: number };
  readonly commands: readonly BotCommand[];
}

/** The Разделы of the Главное меню that a command opens directly. */
const SECTIONS: readonly BotCommand[] = [
  { command: "start", description: "Главное меню" },
  { command: "train", description: "Тренажёр" },
  { command: "models", description: "ИИ-модели" },
  { command: "help", description: "Помощь" },
];

/**
 * The command menu the bot should show. Only the owner's chat also lists `/admin`; other
 * authors still open Управление from the Главное меню.
 */
export function planBotCommands(
  ownerChatId: string,
): readonly BotCommandsTarget[] {
  if (!/^[1-9]\d{0,15}$/.test(ownerChatId))
    throw new Error(
      "TELEGRAM_OWNER_CHAT_ID must be the owner's numeric Telegram ID",
    );
  return [
    {
      audience: "private",
      scope: { type: "all_private_chats" },
      commands: SECTIONS,
    },
    {
      audience: "owner",
      scope: { type: "chat", chat_id: Number(ownerChatId) },
      commands: [
        ...SECTIONS,
        { command: "admin", description: "Управление рассылками" },
      ],
    },
  ];
}

const commandList = z.array(
  z.object({ command: z.string(), description: z.string() }),
);

/** True when Telegram already shows exactly these commands, in this order. */
export function botCommandsCurrent(
  target: BotCommandsTarget,
  current: unknown,
): boolean {
  const actual = commandList.safeParse(current).data;
  return (
    actual !== undefined &&
    actual.length === target.commands.length &&
    target.commands.every(
      (expected, index) =>
        actual[index]?.command === expected.command &&
        actual[index].description === expected.description,
    )
  );
}
