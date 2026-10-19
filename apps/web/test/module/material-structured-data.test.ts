import { z } from "zod";
import { describe, expect, it } from "vitest";

import { materialArticleJsonLd } from "@/_pages/material-reader";
import type { MaterialReaderMetadata } from "@/_pages/material-reader";

const freeMaterialReaderMetadata: MaterialReaderMetadata = {
  access: "free",
  contentVersion: 1,
  cover: null,
  difficulty: null,
  outcomes: [],
  format: { name: "Гайд", slug: "guide" },
  materialId: "72000000-0000-4000-8000-000000000020",
  publishedAt: "2026-08-25T05:00:00.000Z",
  seriesMemberships: [],
  slug: "open-guide",
  summary: "Описание статьи",
  tags: [],
  title: "Открытый гайд",
  topic: { name: "Platform", slug: "platform" },
};

describe("Разметка открытой статьи", () => {
  it("не раскрывает закрытый материал", () => {
    expect(
      materialArticleJsonLd(new URL("https://inside.example.test"), {
        ...freeMaterialReaderMetadata,
        access: "closed",
      }),
    ).toBeNull();
  });
  it("сохраняет авторский текст, не позволяя ему закрыть script", () => {
    const title = '</script><script>alert("x")</script>';
    const json = materialArticleJsonLd(new URL("https://inside.example.test"), {
      ...freeMaterialReaderMetadata,
      title,
      summary: title,
    });
    expect(json).not.toContain("<");
    expect(article(json).headline).toBe(title);
    expect(article(json).description).toBe(title);
  });
  it("использует настоящую обложку с абсолютным адресом", () => {
    const json = materialArticleJsonLd(new URL("https://inside.example.test"), {
      ...freeMaterialReaderMetadata,
      cover: {
        coverId: "72000000-0000-4000-8000-000000000021",
        renditions: [{ width: 1280, height: 720 }],
      },
    });
    expect(article(json).image).toEqual([
      "https://inside.example.test/api/content-covers/72000000-0000-4000-8000-000000000021/1280",
    ]);
  });
  it("описывает открытую статью без выдуманной обложки и даты обновления", () => {
    const json = materialArticleJsonLd(new URL("https://inside.example.test"), {
      ...freeMaterialReaderMetadata,
      slug: "open-guide",
      title: "Открытый гайд",
      cover: null,
    });
    expect(json).not.toBeNull();
    expect(article(json)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Открытый гайд",
      mainEntityOfPage: "https://inside.example.test/materials/open-guide",
      author: { "@type": "Person", name: "Кирилл Сачков" },
    });
    expect(article(json)).not.toHaveProperty("image");
    expect(article(json)).not.toHaveProperty("dateModified");
  });
});

function article(json: string | null): Record<string, unknown> {
  if (json === null) throw new Error("Expected public article JSON-LD");
  return z.record(z.string(), z.unknown()).parse(JSON.parse(json));
}
