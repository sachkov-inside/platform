import { describe, expect, it } from "vitest";
import { feedLink } from "@/entities/material/model/feed-link";

describe("public feed link", () => {
  it("uses the editor link without trimming valid destination punctuation", () => {
    expect(feedLink("Документация", "https://example.com/search?q=what?")?.href).toBe("https://example.com/search?q=what?");
    expect(feedLink("Документация", "javascript:alert(1)")).toBeUndefined();
  });
  it("preserves balanced URL parentheses while removing an enclosing prose bracket", () => {
    const href = "https://en.wikipedia.org/wiki/Function_(mathematics)";
    expect(feedLink(`Пример (${href}).`)?.href).toBe(href);
  });
  it("recognizes a prose link without taking trailing punctuation into the destination", () => {
    expect(feedLink("Пример: https://www.example.com/docs?q=hello#start. Ещё текст")).toEqual({ href: "https://www.example.com/docs?q=hello#start", label: "example.com" });
  });

  it("leaves unsafe schemes and malformed links as text", () => {
    expect(feedLink("javascript:alert(1) data:text/html,test https://")).toBeUndefined();
  });

  it("does not show credential-bearing links and can use the next public address", () => {
    expect(feedLink("https://user:secret@example.com https://docs.example.com/page")).toEqual({ href: "https://docs.example.com/page", label: "docs.example.com" });
  });
});
