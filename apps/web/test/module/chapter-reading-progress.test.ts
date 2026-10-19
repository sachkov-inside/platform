import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MaterialReadingScope,
  type MaterialReadingValue,
} from "../../src/entities/material/model/reading-context.client";
import { ChapterReadingProgress } from "../../src/_pages/library-discovery/ui/chapter-reading-progress.client";

function render(
  materialIds: readonly string[],
  overrides: Partial<MaterialReadingValue> = {},
) {
  const value: MaterialReadingValue = {
    accountId: "reader-1",
    resolved: true,
    failed: false,
    states: new Map(),
    register: () => () => undefined,
    refresh: () => Promise.resolve(),
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(MaterialReadingScope, {
      value,
      children: createElement(ChapterReadingProgress, {
        materialIds,
        name: "Глава",
      }),
    }),
  );
}
describe("chapter reading progress", () => {
  it("counts unique chapter materials and ignores marks from other chapters", () => {
    const html = render(["a", "b", "a"], {
      states: new Map([
        ["a", { isRead: true, version: 1 }],
        ["b", { isRead: false, version: 1 }],
        ["other", { isRead: true, version: 1 }],
      ]),
    });
    expect(html).toContain("Изучено 1 из 2 материалов главы");
  });
  it("shows zero for a guest even if stale marks exist", () => {
    expect(
      render(["a"], {
        accountId: null,
        states: new Map([["a", { isRead: true, version: 1 }]]),
      }),
    ).toContain("Изучено 0 из 1 материалов главы");
  });
  it("does not present incomplete loaded states as zero progress", () => {
    const html = render(["a", "b"], {
      states: new Map([["a", { isRead: true, version: 1 }]]),
    });
    expect(html).toContain("загружается");
    expect(html).not.toContain("Изучено 0");
  });
  it("distinguishes a failed read from zero progress", () => {
    const html = render(["a"], { failed: true });
    expect(html).toContain("недоступен");
    expect(html).not.toContain("Изучено 0");
  });
  it("keeps an empty chapter free of a zero-of-zero counter", () => {
    const html = render([]);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("из");
  });
});
