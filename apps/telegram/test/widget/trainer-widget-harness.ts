import { readFile } from "node:fs/promises";

import { buildTrainerWidgetHtml } from "../../scripts/trainer-widget/build.js";

// A stand-in for the Telegram app around the widget, after the guide's "A first look in a
// browser": the chat palette as CSS variables, the app's default text style, and a
// TelegramWidget object whose request() answers from a queue the test fills.
// A browser is not a Telegram app: it enforces no widget limit and draws with its own fonts.
//
// The checks measure text, so the widget draws with one fixed font on every machine (#2026):
// Roboto, the Android client's font, from `fonts/` (SIL OFL 1.1, `fonts/OFL.txt`). Left to
// `system-ui, sans-serif`, the sizes follow whatever the machine has installed: SF on macOS,
// DejaVu or a CJK font on Linux runners. Faces built from bytes are ready before the widget's
// script fits its text; emoji still come from the system.
const TEST_FONT_FAMILY = "Trainer Widget Test Roboto";
const testFontFaces = [
  {
    file: "roboto-latin-wght-normal.woff2",
    unicodeRange:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  },
  {
    file: "roboto-cyrillic-wght-normal.woff2",
    unicodeRange: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
  },
] as const;
let testFontScript: Promise<string> | undefined;

function testFonts(): Promise<string> {
  testFontScript ??= Promise.all(
    testFontFaces.map(async ({ file, unicodeRange }) => ({
      bytes: (
        await readFile(new URL(`fonts/${file}`, import.meta.url))
      ).toString("base64"),
      unicodeRange,
    })),
  ).then(
    (faces) => `for (const face of ${JSON.stringify(faces)}) {
  const bytes = Uint8Array.from(atob(face.bytes), (c) => c.charCodeAt(0));
  document.fonts.add(new FontFace(${JSON.stringify(TEST_FONT_FAMILY)}, bytes, { weight: "100 900", unicodeRange: face.unicodeRange }));
}`,
  );
  return testFontScript;
}

export type WidgetTheme = "light" | "dark";

export interface WidgetPageOptions {
  /** JSON text of the message's chat state, as sendWidget would carry it in `chat_data`. */
  readonly chatData: string | null;
  readonly theme?: WidgetTheme;
  /** The chat's message text size; it follows the user's text size setting. */
  readonly textSizePx?: number;
  /** Bottom band covered by Telegram message time when the widget has no caption. */
  readonly safeAreaBottomPx?: number;
  /** Native clients may embed the fragment in a document without a doctype. */
  readonly documentMode?: "standards" | "quirks";
}

const palettes: Record<WidgetTheme, Record<string, string>> = {
  light: {
    "bg-color": "#ffffff",
    "text-color": "#000000",
    "hint-color": "#707579",
    "secondary-bg-color": "#f1f1f4",
  },
  dark: {
    "bg-color": "#212121",
    "text-color": "#ffffff",
    "hint-color": "#aaaaaa",
    "secondary-bg-color": "#2c2c2e",
  },
};

export async function trainerWidgetPage(
  options: WidgetPageOptions,
): Promise<string> {
  const theme = options.theme ?? "light";
  const textSize = String(options.textSizePx ?? 15);
  const variables = Object.entries(palettes[theme])
    .map(([key, value]) => `--tg-theme-${key}:${value}`)
    .join(";");
  const [html, fonts] = await Promise.all([
    buildTrainerWidgetHtml(),
    testFonts(),
  ]);
  return `${options.documentMode === "quirks" ? "" : "<!doctype html>"}<html lang="ru"><head><meta charset="utf-8">
<style>
:root{${variables};--tg-color-scheme:${theme};--tg-text-font-size:${textSize}px;--tg-content-safe-area-inset-bottom:${String(options.safeAreaBottomPx ?? 0)}px;--tg-text-line-height:1.35}
body{margin:8px 12px;background:var(--tg-theme-bg-color);color:var(--tg-theme-text-color);font:${textSize}px/1.35 system-ui,sans-serif}
body,#w,#w *{font-family:${JSON.stringify(TEST_FONT_FAMILY)},sans-serif!important}
</style>
<script>
${fonts}
window.widgetRequests = [];
window.widgetAnswers = [];
window.widgetEvents = {};
window.TelegramWidget = {
  profile: 1, isProfileAtLeast: (n) => n <= 1, colorScheme: ${JSON.stringify(theme)}, themeParams: {}, isActive: true,
  isPreview: false, isForward: false, chatType: "private", viewer: { id: 1, first_name: "Synthetic" },
  chatData: ${JSON.stringify(options.chatData)}, publicData: null, wallet: null,
  contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0, cornerLeft: 0, cornerRight: 0 },
  onEvent(type, handler) { window.widgetEvents[type] = handler; }, offEvent() {}, ready() {}, setResizeAnchor(anchor) { window.widgetResizeAnchor = anchor; },
  request(data) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data).length : 0;
    if (bytes < 1 || bytes > 64) throw new TypeError("request data must be 1-64 bytes");
    window.widgetRequests.push(data);
    const answer = window.widgetAnswers.shift();
    if (answer === undefined) {
      const error = new Error("TIMEOUT");
      error.name = "WidgetRequestError";
      error.code = "TIMEOUT";
      return Promise.reject(error);
    }
    return Promise.resolve({ result: answer });
  },
};
</script></head><body>${html}</body></html>`;
}

const realisticWords =
  "Синтетический вопрос про условный предмет и его свойство в длинной формулировке для замера высоты экрана на узком телефоне".split(
    " ",
  );
// The widest lowercase Cyrillic letters in words of ordinary length: wider than real text.
const wideWords = ["жшщмыюшж", "щыжю", "мюшщжыш", "шжщ", "ыюмжшщюмыж"];

function filler(
  words: readonly string[],
  length: number,
  seed: number,
): string {
  let text = "";
  for (let index = seed; text.length < length; index += 1)
    text += `${text.length > 0 ? " " : ""}${String(words[index % words.length])}`;
  return text.slice(0, length).trimEnd().padEnd(length, "я");
}

/** Synthetic Russian-looking text of exactly `length` characters. */
export const realisticText = (length: number, seed = 0): string =>
  filler(realisticWords, length, seed);
/** Synthetic text of exactly `length` characters built from the widest letters. */
export const wideText = (length: number, seed = 0): string =>
  filler(wideWords, length, seed);

/** Splits a total length between `count` texts as evenly as whole characters allow. */
export function splitLength(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) =>
    index < total % count ? base + 1 : base,
  );
}
