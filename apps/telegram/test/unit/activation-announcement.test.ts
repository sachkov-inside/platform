import { describe, expect, it } from "vitest";
import type { ActivationConfig } from "../../src/config/activation-config.js";
import { announceActivation } from "../../src/modules/subscription-activation/activation-announcement.js";
import type { TelegramTextMessage } from "../../src/modules/outbound/telegram-messages.js";

const activation: ActivationConfig = {
  enabled: true,
  endpoint: "https://platform.example/activation",
  secret: "s".repeat(32),
  accountUrl: "https://platform.example/account",
  sources: [
    { sourceRef: "course", chatId: "-1000000000001", policy: "whole_group" },
  ],
};
const input = {
  activation,
  sourceRef: "course",
  productId: "product-a",
  code: "course64",
  text: "Точный текст владельца.\n\nБез изменений.",
  privateChatId: "1234",
  operationId: "send-1",
  send: true,
};
function ports() {
  const sent: TelegramTextMessage[] = [];
  return {
    sent,
    telegram: {
      botUsername: () => Promise.resolve("inside_bot"),
      privateChat: () => Promise.resolve(true),
      sendText: (message: TelegramTextMessage) => {
        sent.push(message);
        return Promise.resolve({
          kind: "delivered" as const,
          providerMessageId: "7",
        });
      },
    },
    platform: {
      resolve: () =>
        Promise.resolve({ sourceRef: "course", productId: "product-a" }),
    },
    deliveries: {
      claim: (_id: string, _fingerprint: string) => Promise.resolve(true),
      complete: () => Promise.resolve(),
    },
  };
}
describe("the owner's private activation announcement", () => {
  it("delivers exact supplied text privately with one Product activation button", async () => {
    const p = ports();
    expect(
      await announceActivation(input, p.telegram, p.platform, p.deliveries),
    ).toMatchObject({ status: "sent" });
    expect(p.sent).toEqual([
      {
        chatId: "1234",
        text: input.text,
        buttons: [
          {
            text: "Получить доступ",
            url: "https://t.me/inside_bot?start=a_course64",
          },
        ],
      },
    ]);
  });
  it.each([
    ["invalid_text", { text: "   " }],
    ["invalid_text", { text: "x".repeat(4097) }],
    ["not_private", { privateChatId: "-1000000000001" }],
    ["not_private", { privateChatId: "@owner" }],
    ["invalid_operation", { operationId: "" }],
  ])("refuses %s before any delivery", async (reason, change) => {
    const p = ports();
    expect(
      await announceActivation(
        { ...input, ...change },
        p.telegram,
        p.platform,
        p.deliveries,
      ),
    ).toEqual({ status: "refused", reason });
    expect(p.sent).toEqual([]);
  });
  it("refuses a non-private Telegram destination even with a positive id", async () => {
    const p = ports();
    p.telegram.privateChat = () => Promise.resolve(false);
    expect(
      await announceActivation(input, p.telegram, p.platform, p.deliveries),
    ).toEqual({ status: "refused", reason: "not_private" });
    expect(p.sent).toEqual([]);
  });
  it.each([
    undefined,
    { sourceRef: "other", productId: "product-a" },
    { sourceRef: "course", productId: "other" },
  ])("refuses unavailable or mismatched trusted rules", async (rule) => {
    const p = ports();
    expect(
      await announceActivation(
        input,
        p.telegram,
        { resolve: () => Promise.resolve(rule) },
        p.deliveries,
      ),
    ).toEqual({ status: "refused", reason: "rule_mismatch" });
    expect(p.sent).toEqual([]);
  });
  it("does not repeat a claimed operation after an unknown result", async () => {
    const p = ports();
    const claimed = new Set<string>();
    p.deliveries.claim = (id: string) => {
      if (claimed.has(id)) return Promise.resolve(false);
      claimed.add(id);
      return Promise.resolve(true);
    };
    const transport = {
      ...p.telegram,
      sendText: (message: TelegramTextMessage) => {
        p.sent.push(message);
        return Promise.resolve({ kind: "transport_unknown" as const });
      },
    };
    expect(
      await announceActivation(input, transport, p.platform, p.deliveries),
    ).toEqual({ status: "unknown" });
    expect(
      await announceActivation(input, transport, p.platform, p.deliveries),
    ).toEqual({ status: "refused", reason: "already_attempted" });
    expect(p.sent).toHaveLength(1);
  });
  it("previews exact owner copy without reserving or sending", async () => {
    const p = ports();
    const result = await announceActivation(
      { ...input, send: false },
      p.telegram,
      p.platform,
      {
        claim: () => Promise.reject(new Error("Preview must not reserve")),
        complete: () => Promise.reject(new Error("Preview must not settle")),
      },
    );
    expect(result).toEqual({
      status: "ready",
      text: input.text,
      button: {
        text: "Получить доступ",
        url: "https://t.me/inside_bot?start=a_course64",
      },
    });
    expect(p.sent).toEqual([]);
  });
  it.each([
    ["activation_disabled", { activation: undefined }],
    ["invalid_code", { code: "course!" }],
    ["unknown_source", { sourceRef: "unknown" }],
    [
      "not_whole_group",
      {
        activation: {
          ...activation,
          sources: [
            {
              sourceRef: "course",
              chatId: "-1000000000001",
              policy: "confirmed_list" as const,
            },
          ],
        },
      },
    ],
  ])("retains the %s source safety check", async (reason, change) => {
    const p = ports();
    expect(
      await announceActivation(
        { ...input, ...change },
        p.telegram,
        p.platform,
        p.deliveries,
      ),
    ).toEqual({ status: "refused", reason });
    expect(p.sent).toEqual([]);
  });
  it("refuses without a trustworthy bot username", async () => {
    const p = ports();
    expect(
      await announceActivation(
        input,
        { ...p.telegram, botUsername: () => Promise.resolve(undefined) },
        p.platform,
        p.deliveries,
      ),
    ).toEqual({ status: "refused", reason: "no_bot_username" });
    expect(p.sent).toEqual([]);
  });
  it("reports Telegram refusal separately from an unknown delivery", async () => {
    const p = ports();
    expect(
      await announceActivation(
        input,
        {
          ...p.telegram,
          sendText: () =>
            Promise.resolve({ kind: "api_rejected", providerErrorCode: 403 }),
        },
        p.platform,
        p.deliveries,
      ),
    ).toEqual({ status: "not_sent", providerErrorCode: 403 });
  });
});
