import { afterEach, expect, it, vi } from "vitest";

import { installAppShellPrefetchClassifier } from "../support/app-shell-prefetch";

afterEach(() => vi.unstubAllGlobals());

it("recognizes complete runtime and static page shells, excluding tree, layout and per-link data", () => {
  vi.stubGlobal("window", {});
  installAppShellPrefetchClassifier();
  const classify = (mode: string | null, segment: string | null) => {
    const headers = new Headers({ rsc: "1" });
    if (mode !== null) headers.set("next-router-prefetch", mode);
    if (segment !== null) headers.set("next-router-segment-prefetch", segment);
    return window.__isAppShellPrefetch(headers);
  };
  expect(classify("3", null)).toBe(true);
  expect(classify("1", "/(public)/materials/$d$slug/__PAGE__")).toBe(true);
  expect(classify("1", "/_tree")).toBe(false);
  expect(classify("1", "/(public)/layout")).toBe(false);
  expect(classify("3", "/_tree")).toBe(false);
  expect(classify("2", null)).toBe(false);
  expect(classify(null, null)).toBe(false);
  expect(
    window.__isAppShellPrefetch(new Headers({ "next-router-prefetch": "3" })),
  ).toBe(false);
});
