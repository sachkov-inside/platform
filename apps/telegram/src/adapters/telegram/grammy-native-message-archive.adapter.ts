import type { Api } from "grammy";
import type {
  NativeArchiveCommand,
  NativeArchiveResult,
  NativeMessageArchive,
} from "../../modules/communications/native-message-archive.js";
import {
  nativeMessageSource,
  type NativeMessageSource,
} from "../../modules/communications/native-message-source.js";
import { fileId } from "../../modules/communications/native-album-media.js";
import { nativeContent } from "../../modules/communications/native-message-content.js";
import { validateContent } from "../../modules/communications/communications-contract.js";
import { telegramCommunicationFailure } from "./telegram-communication-failure.js";

/** Capture returns full authoritative Messages; delivery alone uses opaque copy methods. */
export class GrammyNativeMessageArchive implements NativeMessageArchive {
  constructor(
    private readonly api: Pick<Api, "forwardMessage" | "sendMediaGroup">,
  ) {}
  async archive(command: NativeArchiveCommand): Promise<NativeArchiveResult> {
    const { sources, chatId } = command;
    if (
      !/^[1-9][0-9]*$/u.test(chatId) ||
      sources.length < 1 ||
      sources.length > 10 ||
      sources.some(
        (source, index) =>
          source.rejection !== undefined ||
          !Number.isSafeInteger(source.messageId) ||
          source.messageId <= 0 ||
          (index > 0 &&
            source.messageId <= (sources[index - 1]?.messageId ?? 0)),
      )
    )
      return { kind: "api_rejected", providerErrorCode: 400 };
    if (
      sources.length > 1 &&
      (sources[0]?.mediaGroupId === undefined ||
        sources.some(
          (source) => source.mediaGroupId !== sources[0]?.mediaGroupId,
        ))
    )
      return { kind: "api_rejected", providerErrorCode: 400 };
    const media = sources.map((source) => source.albumMedia);
    if (sources.length > 1 && !validAlbum(media))
      return { kind: "api_rejected", providerErrorCode: 400 };
    // Validate frozen input URLs/buttons too. Full body metadata is replaced from the provider result.
    try {
      validateContent(
        nativeContent("00000000-0000-4000-8000-000000000000", sources),
      );
    } catch {
      return { kind: "api_rejected", providerErrorCode: 400 };
    }
    let returned: readonly unknown[];
    try {
      const first = sources[0];
      if (!first) return { kind: "api_rejected", providerErrorCode: 400 };
      if (sources.length === 1) {
        returned = [
          await this.api.forwardMessage(chatId, chatId, first.messageId),
        ];
      } else {
        if (!validAlbum(media))
          return { kind: "api_rejected", providerErrorCode: 400 };
        returned = await this.api.sendMediaGroup(chatId, media);
      }
    } catch (error) {
      return telegramCommunicationFailure(error);
    }
    // After a successful effect an invalid/incomplete response must never turn into a retry.
    try {
      if (returned.length !== sources.length)
        return { kind: "transport_unknown" };
      const archived: NativeMessageSource[] = [],
        messageIds: number[] = [];
      let albumGroup: string | undefined;
      for (const [index, value] of returned.entries()) {
        const original = sources[index];
        if (
          !record(value) ||
          !record(value["chat"]) ||
          String(value["chat"]["id"]) !== chatId ||
          !original
        )
          return { kind: "transport_unknown" };
        const actual = nativeMessageSource(value);
        if (!actual || actual.rejection !== undefined)
          return { kind: "transport_unknown" };
        if (sources.length > 1) {
          if (
            actual.mediaGroupId === undefined ||
            (albumGroup !== undefined && actual.mediaGroupId !== albumGroup)
          )
            return { kind: "transport_unknown" };
          albumGroup = actual.mediaGroupId;
        }
        messageIds.push(actual.messageId);
        archived.push({
          messageId: original.messageId,
          text: actual.text,
          links: actual.links,
          ...(original.mediaGroupId !== undefined
            ? { mediaGroupId: original.mediaGroupId }
            : {}),
          ...(original.buttons !== undefined
            ? { buttons: original.buttons }
            : {}),
        });
      }
      if (
        new Set(messageIds).size !== messageIds.length ||
        messageIds.some(
          (id, index) => index > 0 && id <= (messageIds[index - 1] ?? 0),
        )
      )
        return { kind: "transport_unknown" };
      validateContent(
        nativeContent("00000000-0000-4000-8000-000000000000", archived),
      );
      return { kind: "delivered", messageIds, sources: archived };
    } catch {
      return { kind: "transport_unknown" };
    }
  }
}
function validAlbum(
  media: readonly unknown[],
): media is Parameters<Api["sendMediaGroup"]>[1] {
  const kinds = new Set<string>();
  for (const item of media) {
    if (
      !record(item) ||
      !fileId(item["media"]) ||
      typeof item["type"] !== "string" ||
      !["photo", "video", "audio", "document", "live_photo"].includes(
        item["type"],
      ) ||
      !Object.keys(item).every((key) =>
        [
          "type",
          "media",
          "photo",
          "caption",
          "caption_entities",
          "has_spoiler",
          "show_caption_above_media",
          "width",
          "height",
          "duration",
          "performer",
          "title",
          "start_timestamp",
          "cover",
        ].includes(key),
      ) ||
      ((item["type"] === "live_photo" || item["photo"] !== undefined) &&
        !fileId(item["photo"])) ||
      (item["cover"] !== undefined && !fileId(item["cover"]))
    )
      return false;
    kinds.add(item["type"]);
  }
  return kinds.has("audio")
    ? kinds.size === 1
    : kinds.has("document")
      ? kinds.size === 1
      : true;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
