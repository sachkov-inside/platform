import { describe, expect, it } from "vitest";

import {
  materialReaderHref,
  materialReaderOriginHref,
  parseMaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";

describe("Material Reader navigation", () => {
  it("round-trips a Playlist, Topic and related Material origin", () => {
    const seriesHref = materialReaderOriginHref("series", "platform-inside");
    expect(materialReaderHref("inside-platform-overview", seriesHref)).toBe(
      "/materials/inside-platform-overview?from=%2Fseries%2Fplatform-inside",
    );
    expect(parseMaterialReaderReturnTarget(seriesHref)).toEqual({
      href: "/series/platform-inside",
      kind: "series",
      label: "Назад к плейлисту",
    });

    expect(parseMaterialReaderReturnTarget("/topics/platform")).toEqual({
      href: "/topics/platform",
      kind: "topic",
      label: "Назад к теме",
    });

    const sourceHref = materialReaderHref("inside-platform-overview", seriesHref);
    const relatedHref = materialReaderHref("related-architecture", sourceHref);
    expect(parseMaterialReaderReturnTarget(new URL(relatedHref, "https://inside.local").searchParams.get("from"))).toEqual({
      href: sourceHref,
      kind: "material",
      label: "Назад к материалу",
    });
  });

  it("falls back to Library for direct, external and malformed origins", () => {
    for (const value of [
      undefined,
      "https://attacker.example/series/platform-inside",
      "//attacker.example/series/platform-inside",
      "/series/platform-inside?unexpected=true",
      "/admin",
      ["/series/one", "/series/two"],
    ]) {
      expect(parseMaterialReaderReturnTarget(value)).toEqual({
        href: "/library",
        kind: "library",
        label: "Назад в Базу знаний",
      });
    }
  });
});
