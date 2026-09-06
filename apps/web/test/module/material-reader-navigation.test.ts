import { describe, expect, it } from "vitest";

import {
  collectionDiscoveryHref,
  materialReaderHref,
  materialReaderOriginHref,
  parseMaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";

describe("Material Reader navigation", () => {
  it("round-trips Home, Library, Playlist, Topic and Profile origins", () => {
    expect(collectionDiscoveryHref("topic", "platform", "/")).toBe(
      "/topics/platform?from=%2F",
    );
    const topicHref = materialReaderOriginHref("topic", "platform");
    expect(
      collectionDiscoveryHref("series", "platform-inside", topicHref),
    ).toBe("/series/platform-inside?from=%2Ftopics%2Fplatform");
    const seriesHref = materialReaderOriginHref("series", "platform-inside");
    expect(materialReaderHref("inside-platform-overview", seriesHref)).toBe(
      "/materials/inside-platform-overview?from=%2Fseries%2Fplatform-inside",
    );
    expect(parseMaterialReaderReturnTarget(seriesHref)).toEqual({
      href: "/series/platform-inside",
      kind: "series",
      label: "Назад к серии",
      seriesSlug: "platform-inside",
    });

    expect(parseMaterialReaderReturnTarget("/topics/platform")).toEqual({
      href: "/topics/platform",
      kind: "topic",
      label: "Назад к теме",
    });

    expect(parseMaterialReaderReturnTarget("/")).toEqual({
      href: "/",
      kind: "home",
      label: "Назад на Главную",
    });
    expect(parseMaterialReaderReturnTarget("/account")).toEqual({
      href: "/account",
      kind: "profile",
      label: "Назад в профиль",
    });

    const filteredLibrary = parseMaterialReaderReturnTarget(
      "/library?q=platform&format=video&sort=title",
    );
    expect(filteredLibrary).toEqual({
      href: "/library?q=platform&format=video&sort=title",
      kind: "library",
      label: "Назад в Базу знаний",
    });
    const nestedTopic = collectionDiscoveryHref(
      "topic",
      "platform",
      filteredLibrary.href,
    );
    expect(
      collectionDiscoveryHref("series", "platform-inside", nestedTopic),
    ).toBe(
      "/series/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252Flibrary%253Fq%253Dplatform%2526format%253Dvideo%2526sort%253Dtitle",
    );
  });

  it("falls back to Library for direct, external and malformed origins", () => {
    for (const value of [
      undefined,
      "https://attacker.example/series/platform-inside",
      "//attacker.example/series/platform-inside",
      "/series/platform-inside?unexpected=true",
      "/library?after=cursor",
      "/library?format=workshop",
      "/library?q=one&q=two",
      "/materials/inside-platform-overview",
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
