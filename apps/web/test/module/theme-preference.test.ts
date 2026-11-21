import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  parseThemePreference,
  themeRestoreSource,
} from "@/features/theme-preference/model/theme-preference";

/**
 * The restore script runs inline in `<head>` before the body exists. The test runs the exact
 * production string against a minimal document, storage and media query, as a browser would.
 */
function runRestore({
  stored,
  systemDark = false,
  storageFails = false,
  matchMediaFails = false,
}: {
  readonly stored?: string;
  readonly systemDark?: boolean;
  readonly storageFails?: boolean;
  readonly matchMediaFails?: boolean;
}) {
  const classes = new Set<string>();
  const meta = { name: "", content: "" };
  const head: (typeof meta)[] = [];
  const root = {
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    style: { colorScheme: "" },
  };
  const document = {
    documentElement: root,
    head: { appendChild: (tag: typeof meta) => head.push(tag) },
    createElement: (tag: string) => {
      if (tag !== "meta") throw new Error(`Unexpected <${tag}>`);
      return meta;
    },
    querySelector: (selector: string) =>
      selector === 'meta[name="theme-color"]'
        ? (head.find((tag) => tag.name === "theme-color") ?? null)
        : null,
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageFails) throw new Error("SecurityError");
      return key === "inside.theme.v1" ? (stored ?? null) : null;
    },
  };
  const matchMedia = (query: string) => {
    if (matchMediaFails) throw new Error("unsupported");
    return { matches: query === "(prefers-color-scheme: dark)" && systemDark };
  };
  runInNewContext(themeRestoreSource, { document, localStorage, matchMedia });
  return {
    dark: classes.has("dark"),
    colorScheme: root.style.colorScheme,
    themeColor: meta.content,
    themeColorTags: head.length,
  };
}

describe("theme preference", () => {
  it("keeps the light theme for a visitor who never chose", () => {
    expect(runRestore({})).toEqual({
      dark: false,
      colorScheme: "light",
      themeColor: "#ffffff",
      themeColorTags: 1,
    });
    expect(parseThemePreference(null)).toBe("light");
  });

  it("restores the chosen dark theme before the first paint", () => {
    expect(runRestore({ stored: "dark" })).toEqual({
      dark: true,
      colorScheme: "dark",
      themeColor: "#18191b",
      themeColorTags: 1,
    });
  });

  it("follows the operating system while «Как в системе» is chosen", () => {
    expect(runRestore({ stored: "system", systemDark: true }).dark).toBe(true);
    expect(runRestore({ stored: "system", systemDark: false }).dark).toBe(
      false,
    );
  });

  it("ignores the operating system for an explicit light choice", () => {
    expect(runRestore({ stored: "light", systemDark: true }).dark).toBe(false);
  });

  it("treats an unknown stored value as light", () => {
    expect(runRestore({ stored: "sepia" }).dark).toBe(false);
    expect(parseThemePreference("sepia")).toBe("light");
  });

  it("never throws when storage or media queries are unavailable", () => {
    expect(runRestore({ storageFails: true }).dark).toBe(false);
    expect(runRestore({ stored: "system", matchMediaFails: true }).dark).toBe(
      false,
    );
    expect(runRestore({ stored: "dark", matchMediaFails: true }).dark).toBe(
      true,
    );
  });
});
