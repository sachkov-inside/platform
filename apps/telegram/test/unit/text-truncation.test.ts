import { describe, expect, it } from "vitest";
import { truncateText } from "../../src/shared/text.js";

describe("truncateText", () => {
  it("drops an emoji whose surrogate pair the limit would split", () => {
    const text = "до 31 января📆, поэтому";
    const limit = text.indexOf("📆") + 1;
    expect(truncateText(text, limit)).toBe("до 31 января");
    expect(JSON.stringify(truncateText(text, limit))).not.toContain("\\ud");
  });
  it("keeps a whole emoji that fits and text within the limit", () => {
    expect(truncateText("января📆, поэтому", 8)).toBe("января📆");
    expect(truncateText("Первое", 80)).toBe("Первое");
    expect(truncateText("", 80)).toBe("");
  });
});
