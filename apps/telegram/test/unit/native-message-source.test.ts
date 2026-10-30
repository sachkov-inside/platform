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

  it("extracts URLs beyond a bounded summary and from nested content", () => {
    const text = "x".repeat(4100) + " https://inside.example/products/course";
    expect(
      nativeMessageSource({
        message_id: 42,
        text,
        rich_message: {
          blocks: [{ url: "https://inside.example/materials/sample" }],
        },
      }),
    ).toEqual({
      messageId: 42,
      text: "x".repeat(4096),
      links: [
        "https://inside.example/materials/sample",
        "https://inside.example/products/course",
      ],
    });
  });
  it("freezes album media separately from its summary", () => {
    expect(
      nativeMessageSource({
        message_id: 42,
        media_group_id: "album",
        photo: [{ file_id: "synthetic_file" }],
        caption: "Caption",
      }),
    ).toEqual({
      messageId: 42,
      mediaGroupId: "album",
      text: "Caption",
      links: [],
      albumMedia: {
        type: "photo",
        media: "synthetic_file",
        caption: "Caption",
        caption_entities: [],
      },
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

describe("nested native entities and embedded actions", () => {
  it.each(["explanation", "description", "question", "caption", "text"])(
    "extracts bare URLs paired with nested %s entities",
    (field) => {
      const url = "inside.example/materials/private";
      const entityField = field === "text" ? "entities" : `${field}_entities`;
      expect(
        nativeMessageSource({
          message_id: 42,
          poll: {
            [field]: url,
            [entityField]: [{ type: "url", offset: 0, length: url.length }],
          },
        })?.links,
      ).toEqual(["https://inside.example/materials/private"]);
      const forbidden = "api.telegram.org/botSynthetic/sendMessage";
      expect(
        nativeMessageSource({
          message_id: 42,
          poll: {
            [field]: forbidden,
            [entityField]: [
              { type: "url", offset: 0, length: forbidden.length },
            ],
          },
        }),
      ).toBeUndefined();
    },
  );
  it.each([
    "callback_data",
    "web_app",
    "login_url",
    "switch_inline_query",
    "unknown_action",
  ])("refuses embedded non-URL action %s", (action) => {
    expect(
      nativeMessageSource({
        message_id: 42,
        rich_message: {
          blocks: [
            {
              type: "buttons",
              buttons: [{ text: "Act", [action]: "synthetic" }],
            },
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      nativeMessageSource({
        message_id: 42,
        rich_message: {
          blocks: [
            {
              text: {
                type: "button",
                button: {
                  text: "Act",
                  url: "https://inside.example",
                  [action]: "synthetic",
                },
              },
            },
          ],
        },
      }),
    ).toBeUndefined();
  });
});

it("maps real spoiler/live-photo compatibility fields", () => {
  const source = nativeMessageSource({
    message_id: 42,
    media_group_id: "album",
    has_media_spoiler: true,
    show_caption_above_media: true,
    photo: [{ file_id: "static_photo" }],
    live_photo: { file_id: "live_video", photo: [{ file_id: "static_photo" }] },
    caption: "Live",
  });
  expect(source?.albumMedia).toEqual({
    type: "live_photo",
    media: "live_video",
    photo: "static_photo",
    caption: "Live",
    caption_entities: [],
    has_spoiler: true,
    show_caption_above_media: true,
  });
});
it("reports a long album caption instead of truncating or pretending it was accepted", () => {
  const source = nativeMessageSource({
    message_id: 42,
    media_group_id: "album",
    photo: [{ file_id: "synthetic_file" }],
    caption: "x".repeat(1025),
  });
  expect(source?.rejection).toBe("album_caption_too_long");
  expect(source?.albumMedia).toBeUndefined();
});
