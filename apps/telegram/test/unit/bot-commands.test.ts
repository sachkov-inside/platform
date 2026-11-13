import { describe, expect, it } from "vitest";

import {
  botCommandsCurrent,
  planBotCommands,
} from "../../src/operations/bot-commands.js";

const everyone = [
  { command: "start", description: "Главное меню" },
  { command: "train", description: "Тренажёр" },
  { command: "models", description: "ИИ-модели" },
  { command: "help", description: "Помощь" },
];

describe("bot command menu", () => {
  it("gives every private chat the sections and the owner's chat management too", () => {
    expect(planBotCommands("424242")).toEqual([
      {
        audience: "private",
        scope: { type: "all_private_chats" },
        commands: everyone,
      },
      {
        audience: "owner",
        scope: { type: "chat", chat_id: 424242 },
        commands: [
          ...everyone,
          { command: "admin", description: "Управление рассылками" },
        ],
      },
    ]);
  });

  it.each(["", "abc", "0", "-100123", "1.5", "99999999999999999999"])(
    "refuses an owner chat that is not a person's private chat: %j",
    (chat) => {
      expect(() => planBotCommands(chat)).toThrow(/TELEGRAM_OWNER_CHAT_ID/);
    },
  );

  it("treats the menu as current only when Telegram returns the same commands in order", () => {
    const [target] = planBotCommands("424242");
    if (!target) throw new Error("no private target");
    expect(botCommandsCurrent(target, everyone)).toBe(true);
    expect(botCommandsCurrent(target, [...everyone].reverse())).toBe(false);
    expect(
      botCommandsCurrent(target, [{ command: "models", description: "x" }]),
    ).toBe(false);
    expect(botCommandsCurrent(target, undefined)).toBe(false);
  });
});
