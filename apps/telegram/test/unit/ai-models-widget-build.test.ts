import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildAiModelsWidgetHtml } from "../../scripts/ai-models-widget/build.js";
import { AI_MODELS_WIDGET_HTML } from "../../src/modules/ai-models/widget/ai-models-widget-html.generated.js";
import {
  WIDGET_PROFILE_1_FORBIDDEN,
  widgetClassNames,
} from "../support/widget-profile.js";

const html = await buildAiModelsWidgetHtml();

describe("ИИ-модели widget build", () => {
  it("fits the HTML limit of sendWidget", () => {
    expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(32_768);
    expect(html).not.toContain("\u0000");
  });

  it("fits 4 096 bytes after zlib level 9 as Node.js counts, which is above the server's count", () => {
    const compressed = deflateSync(Buffer.from(html, "utf8"), { level: 9 });

    expect(compressed.byteLength).toBeLessThanOrEqual(4_096);
  });

  it("keeps the checked-in HTML equal to a fresh build of the source", () => {
    expect(AI_MODELS_WIDGET_HTML).toBe(html);
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
