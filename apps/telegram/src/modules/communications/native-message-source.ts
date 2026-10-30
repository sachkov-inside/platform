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
}

export function nativeMessageSource(
  message: Record<string, unknown>,
): NativeMessageSource | undefined {
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
    while (pending.length > 0) {
      const entry = pending.pop();
      if (!entry || ++visited > 10000 || entry.depth > 32) return undefined;
      const { value } = entry;
      if (typeof value === "string") {
        if (/api\.telegram\.org\.?(?::[0-9]+)?\/file\/bot/iu.test(value))
          return undefined;
        if ((entry.key === "url" || entry.key === "href") && value.length > 0) {
          assertSafeUrl(value);
          links.add(value);
        }
        for (const match of value.matchAll(/\bhttps?:\/\/[^\s<>"']+/giu)) {
          const url = match[0].replace(/[),.!?;:]+$/u, "");
          assertSafeUrl(url);
          links.add(url);
        }
      } else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value))
          pending.push({ key, value: child, depth: entry.depth + 1 });
      }
      if (links.size > 1000) return undefined;
    }
    for (const field of ["entities", "caption_entities"]) {
      const entities = message[field];
      if (!Array.isArray(entities)) continue;
      const entityValues: readonly unknown[] = entities;
      for (const entity of entityValues) {
        if (!record(entity)) return undefined;
        const item = entity;
        if (item["type"] !== "url") continue;
        const offset = item["offset"],
          length = item["length"];
        if (
          typeof offset !== "number" ||
          typeof length !== "number" ||
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length <= 0 ||
          offset + length > rawText.length
        )
          return undefined;
        const value = rawText.slice(offset, offset + length);
        assertSafeUrl(value, true);
        links.add(
          new URL(value.includes("://") ? value : `https://${value}`).href,
        );
      }
    }
  } catch {
    return undefined;
  }
  const buttons = sourceButtons(message["reply_markup"]);
  if (buttons === undefined || (group !== undefined && buttons.length > 0))
    return undefined;
  let text = rawText.slice(0, 4096);
  if (text.length > 0 && /[\uD800-\uDBFF]/u.test(text.at(-1) ?? ""))
    text = text.slice(0, -1);
  return {
    messageId: id,
    ...(typeof group === "string" ? { mediaGroupId: group } : {}),
    text,
    links: [...links].sort(),
    ...(buttons.length > 0 ? { buttons } : {}),
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
