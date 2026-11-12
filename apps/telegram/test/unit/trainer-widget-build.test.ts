import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildTrainerWidgetHtml } from "../../scripts/trainer-widget/build.js";
import { TRAINER_WIDGET_HTML } from "../../src/modules/trainer/widget/trainer-widget-html.generated.js";
import {
  TELEGRAM_WIDGET_COMPRESSED_MAX_BYTES,
  TELEGRAM_WIDGET_HTML_MAX_BYTES,
} from "../../src/modules/trainer/widget/trainer-widget-limits.js";
import {
  WIDGET_PROFILE_1_FORBIDDEN,
  widgetClassNames,
} from "../support/widget-profile.js";

const html = await buildTrainerWidgetHtml();

describe("trainer widget build", () => {
  it("names the Telegram limits from the widget guide", () => {
    expect(TELEGRAM_WIDGET_HTML_MAX_BYTES).toBe(32_768);
    expect(TELEGRAM_WIDGET_COMPRESSED_MAX_BYTES).toBe(4_096);
  });

  it("fits the HTML limit of sendWidget", () => {
    expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(32_768);
    expect(html).not.toContain("\u0000");
  });

  it("fits 4 096 bytes after zlib level 9 as Node.js counts, which is above the server's count", () => {
    const compressed = deflateSync(Buffer.from(html, "utf8"), { level: 9 });

    expect(compressed.byteLength).toBeLessThanOrEqual(
      TELEGRAM_WIDGET_COMPRESSED_MAX_BYTES,
    );
  });

  it("keeps the checked-in HTML equal to a fresh build of the source", () => {
    expect(TRAINER_WIDGET_HTML).toBe(html);
  });

  it("does not distinguish CSS classes only by case in native client documents", () => {
    const names = widgetClassNames(html);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      names.length,
    );
  });

  it.each(WIDGET_PROFILE_1_FORBIDDEN)(
    "stays inside widget profile 1: no %s",
    (_name, pattern) => {
      expect(html).not.toMatch(pattern);
    },
  );
});
