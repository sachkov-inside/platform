import { GrammyError } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { GrammyNativeMessageCopy } from "../../src/adapters/telegram/grammy-native-message-copy.adapter.js";
describe("native Telegram copy", () => {
  it("copies a native message without rebuilding or overriding its caption/entities", async () => {
    const copyMessage = vi.fn().mockResolvedValue({ message_id: 501 });
    const copyMessages = vi.fn();
    const copy = new GrammyNativeMessageCopy({ copyMessage, copyMessages });
    expect(
      await copy.copy({
        chatId: "42",
        sourceChatId: "42",
        messageIds: [7],
        buttons: [{ text: "Open", url: "https://inside.example" }],
      }),
    ).toEqual({ kind: "delivered", messageIds: [501] });
    expect(copyMessage).toHaveBeenCalledWith("42", "42", 7, {
      reply_markup: {
        inline_keyboard: [[{ text: "Open", url: "https://inside.example" }]],
      },
    });
    expect(copyMessages).not.toHaveBeenCalled();
  });
  it("copies an album as one grouped operation and preserves an incomplete result without retrying", async () => {
    const copyMessage = vi.fn();
    const copyMessages = vi
      .fn()
      .mockResolvedValueOnce([{ message_id: 501 }, { message_id: 502 }])
      .mockResolvedValueOnce([{ message_id: 601 }]);
    const copy = new GrammyNativeMessageCopy({ copyMessage, copyMessages });
    const command = {
      chatId: "42",
      sourceChatId: "42",
      messageIds: [7, 8],
      buttons: [],
    };
    expect(await copy.copy(command)).toEqual({
      kind: "delivered",
      messageIds: [501, 502],
    });
    expect(copyMessages).toHaveBeenCalledWith("42", "42", [7, 8]);
    expect(await copy.copy(command)).toEqual({
      kind: "partial",
      messageIds: [601],
    });
    expect(copyMessages).toHaveBeenCalledTimes(2);
    expect(copyMessage).not.toHaveBeenCalled();
  });
});

describe("native Telegram copy failures", () => {
  const command = {
    chatId: "42",
    sourceChatId: "42",
    messageIds: [7],
    buttons: [],
  };
  it.each(
    [[], [0], [8, 7], [7, 7], [Number.MAX_SAFE_INTEGER + 1]].map(
      (messageIds) => ({ messageIds }),
    ),
  )(
    "rejects invalid source IDs %j before provider I/O",
    async ({ messageIds }) => {
      const copyMessage = vi.fn(),
        copyMessages = vi.fn();
      const copy = new GrammyNativeMessageCopy({ copyMessage, copyMessages });
      expect(await copy.copy({ ...command, messageIds })).toEqual({
        kind: "api_rejected",
        providerErrorCode: 400,
      });
      expect(copyMessage).not.toHaveBeenCalled();
      expect(copyMessages).not.toHaveBeenCalled();
    },
  );
  it("refuses album keyboards and unsafe button URLs", async () => {
    const copyMessage = vi.fn(),
      copyMessages = vi.fn();
    const copy = new GrammyNativeMessageCopy({ copyMessage, copyMessages });
    expect(
      (
        await copy.copy({
          ...command,
          messageIds: [7, 8],
          buttons: [{ text: "Open", url: "https://inside.example" }],
        })
      ).kind,
    ).toBe("api_rejected");
    expect(
      (
        await copy.copy({
          ...command,
          buttons: [
            { text: "Open", url: "https://user:secret@inside.example" },
          ],
        })
      ).kind,
    ).toBe("api_rejected");
    expect(copyMessage).not.toHaveBeenCalled();
    expect(copyMessages).not.toHaveBeenCalled();
  });
  it("does not retry network errors or malformed results", async () => {
    const copyMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic timeout"))
      .mockResolvedValueOnce({ message_id: -1 });
    const copy = new GrammyNativeMessageCopy({
      copyMessage,
      copyMessages: vi.fn(),
    });
    expect(await copy.copy(command)).toEqual({ kind: "transport_unknown" });
    expect(await copy.copy(command)).toEqual({ kind: "transport_unknown" });
    expect(copyMessage).toHaveBeenCalledTimes(2);
  });
});

it.each([
  { code: 400, expected: { kind: "api_rejected", providerErrorCode: 400 } },
  {
    code: 429,
    expected: {
      kind: "api_retryable",
      providerErrorCode: 429,
      retryAfterSeconds: 17,
    },
  },
  { code: 503, expected: { kind: "api_retryable", providerErrorCode: 503 } },
])(
  "classifies provider rejection $code without an internal retry",
  async ({ code, expected }) => {
    const copyMessage = vi.fn().mockRejectedValue(
      new GrammyError(
        "synthetic",
        {
          ok: false,
          error_code: code,
          description: "synthetic",
          ...(code === 429 ? { parameters: { retry_after: 17 } } : {}),
        },
        "copyMessage",
        {},
      ),
    );
    const copy = new GrammyNativeMessageCopy({
      copyMessage,
      copyMessages: vi.fn(),
    });
    expect(
      await copy.copy({
        chatId: "42",
        sourceChatId: "42",
        messageIds: [7],
        buttons: [],
      }),
    ).toEqual(expected);
    expect(copyMessage).toHaveBeenCalledTimes(1);
  },
);
