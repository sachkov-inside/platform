import {
  nativeAlbumMedia,
  type NativeAlbumMedia,
} from "./native-album-media.js";
import {
  assertSafeUrl,
  validateContent,
  type TemplateContent,
} from "./communications-contract.js";

/** Telegram source metadata stays private to the provider; consumers receive an opaque reference. */
export interface NativeMessageSource {
  readonly messageId: number;
  readonly mediaGroupId?: string;
  readonly text: string;
  readonly links: readonly string[];
  readonly buttons?: TemplateContent["buttons"];
  readonly albumMedia?: NativeAlbumMedia;
}

export function nativeMessageSource(
  message: Record<string, unknown>,
): NativeMessageSource | undefined {
  if (
    ["paid_media", "invoice", "giveaway", "giveaway_winners"].some(
      (key) => message[key] !== undefined,
    )
  )
    return undefined;
  const id = message["message_id"];
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    return undefined;
  const group = message["media_group_id"];
  if (
    group !== undefined &&
    (typeof group !== "string" || group.length > 128 || group.length === 0)
  )
    return undefined;
  const rawText =
    typeof message["text"] === "string"
      ? message["text"]
      : typeof message["caption"] === "string"
        ? message["caption"]
        : "";
  const links = new Set<string>();
  const ignored = new Set([
    "from",
    "chat",
    "sender_chat",
    "forward_origin",
    "reply_to_message",
    "external_reply",
    "quote",
    "reply_to_story",
    "via_bot",
  ]);
  const pending = Object.entries(message)
    .filter(([key]) => !ignored.has(key))
    .map(([key, value]) => ({ key, value, depth: 0 }));
  let visited = 0;
  try {
    entityUrls(message, links);
    while (pending.length > 0) {
      const entry = pending.pop();
      if (!entry || ++visited > 10000 || entry.depth > 32) return undefined;
      const { value } = entry;
      if (entry.key === "button" && !embeddedButton(value)) return undefined;
      if (entry.key === "buttons") {
        if (!Array.isArray(value)) return undefined;
        const buttons: readonly unknown[] = value;
        if (!buttons.every(embeddedButton)) return undefined;
      }
      if (typeof value === "string") {
        if (/api\.telegram\.org\.?(?::[0-9]+)?\/file\/bot/iu.test(value))
          return undefined;
        if ((entry.key === "url" || entry.key === "href") && value.length > 0) {
          safeLink(value, links);
        }
        for (const match of value.matchAll(/\bhttps?:\/\/[^\s<>"']+/giu)) {
          const url = match[0].replace(/[),.!?;:]+$/u, "");
          safeLink(url, links);
        }
      } else if (value !== null && typeof value === "object") {
        if (record(value)) entityUrls(value, links);
        for (const [key, child] of Object.entries(value))
          pending.push({ key, value: child, depth: entry.depth + 1 });
      }
      if (links.size > 1000) return undefined;
    }
  } catch {
    return undefined;
  }
  const buttons = sourceButtons(message["reply_markup"]);
  if (buttons === undefined || (group !== undefined && buttons.length > 0))
    return undefined;
  const albumMedia =
    group === undefined ? undefined : nativeAlbumMedia(message);
  if (group !== undefined && albumMedia === undefined) return undefined;
  let text = rawText.slice(0, 4096);
  if (text.length > 0 && /[\uD800-\uDBFF]/u.test(text.at(-1) ?? ""))
    text = text.slice(0, -1);
  return {
    messageId: id,
    ...(typeof group === "string" ? { mediaGroupId: group } : {}),
    text,
    links: [...links].sort(),
    ...(buttons.length > 0 ? { buttons } : {}),
    ...(albumMedia !== undefined ? { albumMedia } : {}),
  };
}

function sourceButtons(
  markup: unknown,
): TemplateContent["buttons"] | undefined {
  if (markup === undefined) return [];
  if (
    markup === null ||
    typeof markup !== "object" ||
    !("inline_keyboard" in markup) ||
    !Array.isArray(markup.inline_keyboard)
  )
    return;
  const buttons: unknown[] = [];
  const rows: readonly unknown[] = markup.inline_keyboard;
  for (const [row, value] of rows.entries()) {
    if (!Array.isArray(value)) return;
    const values: readonly unknown[] = value;
    for (const button of values) {
      if (
        button === null ||
        typeof button !== "object" ||
        Array.isArray(button) ||
        Object.keys(button).some((key) => key !== "text" && key !== "url")
      )
        return;
      buttons.push({ ...button, row });
    }
  }
  const content = {
    type: "text",
    text: "Native buttons",
    entities: [],
    buttons,
  };
  try {
    validateContent(content);
    return content.buttons;
  } catch {
    return;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeLink(value: string, links: Set<string>): void {
  if (value.length > 2048) throw new Error("URL limit");
  assertSafeUrl(value);
  links.add(value);
  if (links.size > 1000) throw new Error("URL count limit");
}
function entityUrls(value: Record<string, unknown>, links: Set<string>): void {
  for (const [field, raw] of Object.entries(value)) {
    if (field !== "entities" && !field.endsWith("_entities")) continue;
    if (!Array.isArray(raw)) throw new Error("Invalid entities");
    const entities: readonly unknown[] = raw;
    for (const entity of entities) {
      if (!record(entity)) throw new Error("Invalid entity");
      if (entity["type"] !== "url" || typeof entity["url"] === "string")
        continue;
      const text = value[field === "entities" ? "text" : field.slice(0, -9)];
      const offset = entity["offset"],
        length = entity["length"];
      if (
        typeof text !== "string" ||
        typeof offset !== "number" ||
        typeof length !== "number" ||
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length <= 0 ||
        offset + length > text.length
      )
        throw new Error("Invalid URL range");
      const url = text.slice(offset, offset + length);
      assertSafeUrl(url, true);
      safeLink(
        new URL(url.includes("://") ? url : `https://${url}`).href,
        links,
      );
    }
  }
}
function embeddedButton(value: unknown): boolean {
  return (
    record(value) &&
    typeof value["url"] === "string" &&
    "text" in value &&
    Object.keys(value).every((key) => ["text", "url", "style"].includes(key))
  );
}
