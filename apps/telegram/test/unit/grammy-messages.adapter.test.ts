import { isTruthy } from "../../src/shared/truthiness.js";
import { GrammyError } from "grammy";
import { describe, expect, it } from "vitest";

import { GrammyMessagesAdapter } from "../../src/adapters/telegram/grammy-messages.adapter.js";

describe("GrammyMessagesAdapter", () => {
  it("round-trips an int64-capable chat ID through the Telegram API seam", async () => {
    let receivedChatId: number | undefined;
    const adapter = new GrammyMessagesAdapter("synthetic", {
      editMessageText() {
        return Promise.resolve(true);
      },
      sendMessage(chatId) {
        receivedChatId = chatId;
        return Promise.resolve({ message_id: 99 });
      },
    });

    await expect(
      adapter.sendText({
        chatId: "4503599627370495",
        text: "Synthetic welcome",
      }),
    ).resolves.toEqual({ kind: "delivered", providerMessageId: "99" });
    expect(receivedChatId).toBe(4_503_599_627_370_495);
  });

  it("keeps a stable API rejection terminal", async () => {
    const adapter = adapterThrowing(grammyError(403));

    await expect(sendSynthetic(adapter)).resolves.toEqual({
      kind: "api_rejected",
      providerErrorCode: 403,
    });
  });

  it("classifies 429 and its retry_after as retryable", async () => {
    const adapter = adapterThrowing(grammyError(429, 2));

    await expect(sendSynthetic(adapter)).resolves.toEqual({
      kind: "api_retryable",
      providerErrorCode: 429,
      retryAfterSeconds: 2,
    });
  });

  it("classifies 5xx as retryable and transport failure as unknown", async () => {
    await expect(
      sendSynthetic(adapterThrowing(grammyError(500))),
    ).resolves.toEqual({
      kind: "api_retryable",
      providerErrorCode: 500,
    });
    await expect(
      sendSynthetic(adapterThrowing(new Error("Synthetic transport failure"))),
    ).resolves.toEqual({ kind: "transport_unknown" });
  });
  it("edits the exact prompt and removes the inline keyboard without sending another message", async () => {
    let received: unknown;
    const adapter = new GrammyMessagesAdapter("synthetic", {
      sendMessage() {
        return Promise.reject(new Error("Must edit, not send"));
      },
      editMessageText(chatId, messageId, text, options) {
        received = { chatId, messageId, text, options };
        return Promise.resolve({ message_id: messageId });
      },
    });
    await expect(
      adapter.editText({
        chatId: "42",
        messageId: "100",
        text: "Вход подтверждён. Вернитесь на сайт.",
      }),
    ).resolves.toEqual({ kind: "delivered", providerMessageId: "100" });
    expect(received).toEqual({
      chatId: 42,
      messageId: 100,
      text: "Вход подтверждён. Вернитесь на сайт.",
      options: { reply_markup: { inline_keyboard: [] } },
    });
  });

  it("accepts an already applied edit after a lost acknowledgement", async () => {
    const adapter = new GrammyMessagesAdapter("synthetic", {
      sendMessage() {
        return Promise.reject(new Error("Must edit, not send"));
      },
      editMessageText() {
        return Promise.reject(
          new GrammyError(
            "Synthetic",
            {
              ok: false,
              error_code: 400,
              description:
                "Bad Request: message is not modified: specified new message content is exactly the same",
              parameters: {},
            },
            "editMessageText",
            {},
          ),
        );
      },
    });
    await expect(
      adapter.editText({
        chatId: "42",
        messageId: "100",
        text: "Synthetic result",
      }),
    ).resolves.toEqual({ kind: "delivered", providerMessageId: "100" });
  });

  it("replaces confirmation controls with the public Inside URL on the same message", async () => {
    let keyboard: unknown;
    const adapter = new GrammyMessagesAdapter("synthetic", {
      sendMessage() {
        return Promise.reject(new Error("Must edit, not send"));
      },
      editMessageText(_chatId, _messageId, _text, options) {
        keyboard = options.reply_markup.inline_keyboard;
        return Promise.resolve(true);
      },
    });
    await expect(
      adapter.editText({
        chatId: "42",
        messageId: "100",
        text: "Вход подтверждён. Вернитесь на сайт.",
        buttons: [{ text: "Открыть Inside", url: "https://platform.test/" }],
      }),
    ).resolves.toEqual({ kind: "delivered", providerMessageId: "100" });
    expect(keyboard).toEqual([
      [{ text: "Открыть Inside", url: "https://platform.test/" }],
    ]);
  });
});

describe("GrammyMessagesAdapter widgets", () => {
  const unusedTextApi = {
    editMessageText: () => Promise.reject(new Error("Must not edit")),
    sendMessage: () => Promise.reject(new Error("Must not send a text")),
  };
  const widget = {
    chatId: "4503599627370495",
    html: "<div id=w></div>",
    chatData: '["h",0,0,5,0]',
    caption: "Synthetic caption",
    height: 560,
  };

  it("sends a widget that may query the bot and reports the message id", async () => {
    const received: unknown[] = [];
    const adapter = new GrammyMessagesAdapter("synthetic", unusedTextApi, {
      sendWidget(parameters) {
        received.push(parameters);
        return Promise.resolve({ message_id: 77 });
      },
      answerWidgetQuery: () => Promise.reject(new Error("Must not answer")),
    });

    await expect(adapter.sendWidget(widget)).resolves.toEqual({
      kind: "delivered",
      providerMessageId: "77",
    });
    expect(received).toEqual([
      {
        chat_id: 4_503_599_627_370_495,
        html: "<div id=w></div>",
        chat_data: '["h",0,0,5,0]',
        caption: "Synthetic caption",
        allow_queries: true,
        height: 560,
      },
    ]);
  });

  it.each([
    [grammyError(400), { kind: "api_rejected", providerErrorCode: 400 }],
    [
      grammyError(429, 3),
      { kind: "api_retryable", providerErrorCode: 429, retryAfterSeconds: 3 },
    ],
    [new Error("Synthetic transport failure"), { kind: "transport_unknown" }],
  ])(
    "classifies a failed widget send like a failed text",
    async (error, result) => {
      const adapter = new GrammyMessagesAdapter("synthetic", unusedTextApi, {
        sendWidget: () => Promise.reject(error),
        answerWidgetQuery: () => Promise.reject(new Error("Must not answer")),
      });

      await expect(adapter.sendWidget(widget)).resolves.toEqual(result);
    },
  );

  it("answers a widget query with its data", async () => {
    const received: unknown[] = [];
    const adapter = new GrammyMessagesAdapter("synthetic", unusedTextApi, {
      sendWidget: () => Promise.reject(new Error("Must not send")),
      answerWidgetQuery(parameters) {
        received.push(parameters);
        return Promise.resolve(true);
      },
    });

    await adapter.answerWidgetQuery({ queryId: "q-1", data: '["x"]' });

    expect(received).toEqual([{ widget_query_id: "q-1", data: '["x"]' }]);
  });

  it("does not fail the caller when Telegram refuses a late answer", async () => {
    const adapter = new GrammyMessagesAdapter("synthetic", unusedTextApi, {
      sendWidget: () => Promise.reject(new Error("Must not send")),
      answerWidgetQuery: () => Promise.reject(grammyError(400)),
    });

    await expect(
      adapter.answerWidgetQuery({ queryId: "q-1", data: '["x"]' }),
    ).resolves.toBeUndefined();
  });
});

function adapterThrowing(error: Error): GrammyMessagesAdapter {
  return new GrammyMessagesAdapter("synthetic", {
    editMessageText() {
      return Promise.resolve(true);
    },
    sendMessage() {
      return Promise.reject(error);
    },
  });
}

function grammyError(errorCode: number, retryAfter?: number): GrammyError {
  const error: ConstructorParameters<typeof GrammyError>[1] = {
    description: "Synthetic API rejection",
    error_code: errorCode,
    ok: false,
    parameters: isTruthy(retryAfter) ? { retry_after: retryAfter } : {},
  };
  return new GrammyError("Synthetic API rejection", error, "sendMessage", {});
}

function sendSynthetic(adapter: GrammyMessagesAdapter) {
  return Promise.resolve(
    adapter.sendText({ chatId: "42", text: "Synthetic welcome" }),
  );
}
