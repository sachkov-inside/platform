import { describe, expect, it, vi } from "vitest";
import { GrammyNativeMessageArchive } from "../../src/adapters/telegram/grammy-native-message-archive.adapter.js";
import { nativeMessageSource } from "../../src/modules/communications/native-message-source.js";
import { required } from "../support/required.js";
describe("authoritative native archive", () => {
  it("uses actual forwarded text and links instead of the editable original metadata", async () => {
    const forwardMessage = vi.fn().mockResolvedValue({
      message_id: 501,
      chat: { id: 42, type: "private" },
      text: "Changed https://inside.example/materials/private",
    });
    const archive = new GrammyNativeMessageArchive({
      forwardMessage,
      sendMediaGroup: vi.fn(),
    });
    const result = await archive.archive({
      chatId: "42",
      sources: [{ messageId: 7, text: "Old safe text", links: [] }],
    });
    expect(result).toMatchObject({
      kind: "delivered",
      messageIds: [501],
      sources: [
        {
          messageId: 7,
          text: "Changed https://inside.example/materials/private",
          links: ["https://inside.example/materials/private"],
        },
      ],
    });
    expect(forwardMessage).toHaveBeenCalledWith("42", "42", 7);
  });
  it("freezes the album caption/entities at receipt and never reads mutable original IDs", async () => {
    const caption = "Original https://inside.example/materials/free";
    const message = {
      message_id: 7,
      media_group_id: "original",
      photo: [{ file_id: "synthetic_file" }],
      caption,
      caption_entities: [{ type: "bold", offset: 0, length: 8 }],
      has_media_spoiler: true,
    };
    const first = required(nativeMessageSource(message));
    message.caption =
      "Edited https://user:secret@inside.example/materials/private";
    const sendMediaGroup = vi.fn().mockResolvedValue(
      [7, 8].map((id) => ({
        message_id: id + 500,
        chat: { id: 42, type: "private" },
        media_group_id: "archived",
        photo: [{ file_id: "synthetic_file" }],
        caption,
      })),
    );
    const forwardMessage = vi.fn();
    const archive = new GrammyNativeMessageArchive({
      forwardMessage,
      sendMediaGroup,
    });
    expect(
      (
        await archive.archive({
          chatId: "42",
          sources: [first, { ...first, messageId: 8 }],
        })
      ).kind,
    ).toBe("delivered");
    expect(sendMediaGroup).toHaveBeenCalledWith("42", [
      {
        type: "photo",
        media: "synthetic_file",
        caption,
        caption_entities: [{ type: "bold", offset: 0, length: 8 }],
        has_spoiler: true,
      },
      {
        type: "photo",
        media: "synthetic_file",
        caption,
        caption_entities: [{ type: "bold", offset: 0, length: 8 }],
        has_spoiler: true,
      },
    ]);
    expect(forwardMessage).not.toHaveBeenCalled();
  });
  it.each([
    "https://user:secret@inside.example",
    "api.telegram.org/botSynthetic/sendMessage",
  ])("refuses unsafe actual archive content %s without retry", async (url) => {
    const forwardMessage = vi.fn().mockResolvedValue({
      message_id: 501,
      chat: { id: 42, type: "private" },
      text: url,
      entities: [{ type: "url", offset: 0, length: url.length }],
    });
    const archive = new GrammyNativeMessageArchive({
      forwardMessage,
      sendMediaGroup: vi.fn(),
    });
    expect(
      (
        await archive.archive({
          chatId: "42",
          sources: [{ messageId: 7, text: "Safe", links: [] }],
        })
      ).kind,
    ).toBe("transport_unknown");
    expect(forwardMessage).toHaveBeenCalledTimes(1);
  });
});

it.each([
  {
    name: "foreign chat",
    value: { message_id: 501, chat: { id: 84 }, text: "Hello" },
  },
  {
    name: "invalid ID",
    value: { message_id: 0, chat: { id: 42 }, text: "Hello" },
  },
  {
    name: "unsafe nested body",
    value: {
      message_id: 501,
      chat: { id: 42 },
      poll: {
        explanation: "api.telegram.org/botSynthetic/sendMessage",
        explanation_entities: [{ type: "url", offset: 0, length: 40 }],
      },
    },
  },
])("quarantines $name provider results after the effect", async ({ value }) => {
  const forwardMessage = vi.fn().mockResolvedValue(value);
  const archive = new GrammyNativeMessageArchive({
    forwardMessage,
    sendMediaGroup: vi.fn(),
  });
  expect(
    (
      await archive.archive({
        chatId: "42",
        sources: [{ messageId: 7, text: "Safe", links: [] }],
      })
    ).kind,
  ).toBe("transport_unknown");
  expect(forwardMessage).toHaveBeenCalledTimes(1);
});
it("rejects URL/attach media references before making an archive effect", async () => {
  const forwardMessage = vi.fn(),
    sendMediaGroup = vi.fn();
  const archive = new GrammyNativeMessageArchive({
    forwardMessage,
    sendMediaGroup,
  });
  for (const media of [
    "https://api.telegram.org/file/botSynthetic/file",
    "attach://payload",
  ]) {
    expect(
      (
        await archive.archive({
          chatId: "42",
          sources: [7, 8].map((messageId) => ({
            messageId,
            text: "Safe",
            links: [],
            mediaGroupId: "album",
            albumMedia: { type: "photo", media },
          })),
        })
      ).kind,
    ).toBe("api_rejected");
  }
  expect(forwardMessage).not.toHaveBeenCalled();
  expect(sendMediaGroup).not.toHaveBeenCalled();
});
