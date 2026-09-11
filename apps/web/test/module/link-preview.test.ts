import { describe, expect, it } from "vitest";

import { guideLinkPreview, topicLinkPreview } from "@/_pages/library-discovery";
import { materialLinkPreview } from "@/_pages/material-reader";
import type { MaterialReaderMetadata } from "@/_pages/material-reader";
import { coverLinkPreviewImage } from "@/entities/material.model";
import type { LibraryDiscoveryReference } from "@/features/library-discovery";
import {
  hiddenPageMetadata,
  publicPageMetadata,
  siteLinkPreview,
  socialCardTitle,
} from "@/shared/link-preview";

const origin = new URL("https://inside.example.test");

const material: MaterialReaderMetadata = {
  access: "membership",
  contentVersion: 3,
  cover: null,
  format: { name: "Гайд", slug: "guide" },
  materialId: "72000000-0000-4000-8000-000000000020",
  publishedAt: "2026-08-25T05:00:00.000Z",
  seriesMemberships: [],
  slug: "kak-ustroen-inside",
  summary: "Обещание материала одной строкой.",
  tags: [],
  title: "Как устроен Inside",
  topic: { name: "Platform", slug: "platform" },
};

const guide: LibraryDiscoveryReference = {
  cover: null,
  name: "Создание Platform Inside",
  slug: "platform-inside",
  summary: "Руководство о сборке платформы.",
};

describe("Карточка публичной ссылки", () => {
  it("отдаёт канонический адрес, карточку и открытую индексацию для материала", () => {
    const metadata = publicPageMetadata(origin, "article", materialLinkPreview(material));

    expect(metadata.metadataBase).toEqual(origin);
    expect(metadata.alternates?.canonical).toBe("/materials/kak-ustroen-inside");
    expect(metadata.openGraph).toMatchObject({
      description: "Обещание материала одной строкой.",
      locale: "ru_RU",
      publishedTime: "2026-08-25T05:00:00.000Z",
      siteName: "Sachkov Inside",
      title: "Как устроен Inside",
      type: "article",
      url: "/materials/kak-ustroen-inside",
    });
    expect(metadata.openGraph?.images).toEqual([
      {
        alt: "Как устроен Inside",
        height: 630,
        url: "/materials/kak-ustroen-inside/social-card",
        width: 1200,
      },
    ]);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.robots).toEqual({ follow: true, index: true });
  });

  it("ведёт руководство на канонический адрес `/guides/`, а не на совместимый `/series/`", () => {
    const preview = guideLinkPreview(guide);

    expect(preview.canonicalPath).toBe("/guides/platform-inside");
    expect(preview.title).toBe("Создание Platform Inside — руководство");
    expect(preview.image.url).toBe("/guides/platform-inside/social-card");
  });

  it("называет тему темой и объясняет её содержимое, когда описания нет", () => {
    const preview = topicLinkPreview({ ...guide, name: "Platform", slug: "platform", summary: " " });

    expect(preview.canonicalPath).toBe("/topics/platform");
    expect(preview.title).toBe("Platform — тема");
    expect(preview.description).toBe(
      "Опубликованные материалы по теме «Platform» в авторском порядке.",
    );
  });

  it("даёт главной собственную карточку и название площадки в предпросмотре", () => {
    const metadata = publicPageMetadata(origin, "website", siteLinkPreview());

    expect(metadata.title).toBe("Главная");
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.openGraph).toMatchObject({
      title: "Sachkov Inside",
      type: "website",
      url: "/",
    });
    expect(metadata.openGraph?.images).toEqual([
      { alt: "Sachkov Inside", height: 630, url: "/social-card", width: 1200 },
    ]);
  });

  it("закрывает от индексации страницу, которой нечего показать", () => {
    const metadata = hiddenPageMetadata("Материал не найден");

    expect(metadata).toEqual({
      robots: { follow: false, index: false },
      title: "Материал не найден",
    });
  });
});

describe("Картинка предпросмотра", () => {
  it("берёт обложку не уже карточки, когда она есть", () => {
    const cover = {
      coverId: "72000000-0000-4000-8000-000000000099",
      renditions: [
        { height: 315, width: 600 },
        { height: 840, width: 1600 },
        { height: 630, width: 1200 },
      ],
    };

    expect(coverLinkPreviewImage(cover, "Обложка", "/materials/x/social-card")).toEqual({
      alt: "Обложка",
      height: 630,
      url: "/api/content-covers/72000000-0000-4000-8000-000000000099/1200",
      width: 1200,
    });
  });

  it("берёт самую крупную версию обложки, когда все версии мельче карточки", () => {
    const cover = {
      coverId: "72000000-0000-4000-8000-000000000099",
      renditions: [
        { height: 210, width: 400 },
        { height: 420, width: 800 },
      ],
    };

    expect(coverLinkPreviewImage(cover, "Обложка", "/materials/x/social-card")).toMatchObject({
      url: "/api/content-covers/72000000-0000-4000-8000-000000000099/800",
      width: 800,
    });
  });

  it.each([null, undefined, { coverId: "72000000-0000-4000-8000-000000000099", renditions: [] }])(
    "подставляет сгенерированную карточку вместо пустого предпросмотра: %s",
    (cover) => {
      expect(coverLinkPreviewImage(cover, "Название", "/materials/x/social-card")).toEqual({
        alt: "Название",
        height: 630,
        url: "/materials/x/social-card",
        width: 1200,
      });
    },
  );
});

describe("Название на сгенерированной карточке", () => {
  it("оставляет короткое название как есть и убирает лишние пробелы", () => {
    expect(socialCardTitle("  Как  устроен\nInside ")).toBe("Как устроен Inside");
  });

  it("обрезает длинное название по границе слова", () => {
    const title = socialCardTitle(`${"Слово ".repeat(30)}хвост`);

    expect(title.length).toBeLessThanOrEqual(91);
    expect(title.endsWith("…")).toBe(true);
    expect(title.includes("Слово Слово")).toBe(true);
  });

  it("обрезает длинное название без пробелов", () => {
    expect(socialCardTitle("я".repeat(200))).toBe(`${"я".repeat(90)}…`);
  });
});
