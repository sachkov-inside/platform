import { describe, expect, it } from "vitest";
import { truncateText } from "../../src/shared/text.js";
import { messageLabel } from "../../src/modules/communications/author-message-view.js";

describe("truncateText", () => {
  it("drops an emoji whose surrogate pair the limit would split", () => {
    const text = "до 31 января📆, поэтому";
    const limit = text.indexOf("📆") + 1;
    expect(truncateText(text, limit)).toBe("до 31 января");
  });
  it("keeps a whole emoji that fits and text within the limit", () => {
    expect(truncateText("января📆, поэтому", 8)).toBe("января📆");
    expect(truncateText("Первое", 80)).toBe("Первое");
    expect(truncateText("", 80)).toBe("");
  });
});

describe("messageLabel", () => {
  it("shortens the caption without splitting an emoji at the limit", () => {
    const content = {
      type: "text",
      text: "до 31 января📆, поэтому",
      entities: [],
      buttons: [],
    } as const;
    expect(messageLabel(content, 13)).toBe("📝 Текст · до 31 января");
  });
});
