import { describe, expect, it } from "vitest";
import { nativeMessageSource } from "../../src/modules/communications/native-message-source.js";

describe("native Telegram message source", () => {
  it.each([
    "text",
    "photo",
    "video",
    "animation",
    "audio",
    "voice",
    "video_note",
    "document",
    "sticker",
    "poll",
    "contact",
    "location",
    "venue",
    "dice",
    "rich_message",
    "live_photo",
    "future_content",
  ])("keeps a copyable %s source without rebuilding its content", (kind) => {
    expect(
      nativeMessageSource({ message_id: 42, [kind]: "synthetic" }),
    ).toEqual({
      messageId: 42,
      text: kind === "text" ? "synthetic" : "",
      links: [],
    });
  });

  it("keeps album identity and extracts links beyond the summary without leaking source IDs", () => {
    const caption =
      "x".repeat(4100) + " https://inside.example/products/course";
    expect(
      nativeMessageSource({
        message_id: 42,
        media_group_id: "synthetic-album",
        photo: [],
        caption,
        rich_message: {
          blocks: [{ url: "https://inside.example/materials/sample" }],
        },
      }),
    ).toEqual({
      messageId: 42,
      mediaGroupId: "synthetic-album",
      text: "x".repeat(4096),
      links: [
        "https://inside.example/materials/sample",
        "https://inside.example/products/course",
      ],
    });
  });

  it.each([undefined, 0, -1, 1.5, "42", Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid source identifier %s",
    (messageId) => {
      expect(
        nativeMessageSource({ message_id: messageId, text: "hello" }),
      ).toBeUndefined();
    },
  );
});

describe("native content metadata boundary", () => {
  it.each([
    "http://unsafe.example",
    "https://user:secret@inside.example",
    "https://api.telegram.org/file/botSynthetic/file",
    "https://api.telegram.org./file/botSynthetic/file",
  ])("rejects unsafe copied URLs %s", (url) => {
    expect(
      nativeMessageSource({
        message_id: 42,
        rich_message: { blocks: [{ url }] },
      }),
    ).toBeUndefined();
  });
  it("keeps URL buttons and refuses callback/payment markup", () => {
    expect(
      nativeMessageSource({
        message_id: 42,
        text: "Hello",
        reply_markup: {
          inline_keyboard: [[{ text: "Open", url: "https://inside.example" }]],
        },
      })?.buttons,
    ).toEqual([{ text: "Open", url: "https://inside.example", row: 0 }]);
    expect(
      nativeMessageSource({
        message_id: 42,
        text: "Hello",
        reply_markup: { inline_keyboard: [[{ text: "Pay", pay: true }]] },
      }),
    ).toBeUndefined();
  });
  it("does not persist author, forwarded source or replied-to metadata in the archive summary", () => {
    expect(
      nativeMessageSource({
        message_id: 42,
        text: "Public",
        from: { id: 123, first_name: "Private" },
        reply_to_message: {
          text: "Private",
          entities: [{ url: "http://private.example" }],
        },
      }),
    ).toEqual({ messageId: 42, text: "Public", links: [] });
  });
  it("keeps bare URL entities and does not split a summary surrogate", () => {
    const text = "x".repeat(4095) + "😀 inside.example/materials/free";
    const value = nativeMessageSource({
      message_id: 42,
      text,
      entities: [{ type: "url", offset: 4098, length: 29 }],
    });
    expect(value?.text).toBe("x".repeat(4095));
    expect(value?.links).toEqual(["https://inside.example/materials/free"]);
  });
});
