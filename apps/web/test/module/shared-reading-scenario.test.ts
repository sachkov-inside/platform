import { describe, expect, test } from "vitest";
import { readingHttpMaterials } from "../../../../scenarios/reading-http.mjs";
import {
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material.model";
import { productJourneyCorpus } from "../fixtures/product-journey-corpus.fixtures";

describe("shared reading scenario adapters", () => {
  test("keeps independently authored wire facts compatible with the real web mapper", () => {
    const wire = readingHttpMaterials()[0];
    const parsed = publishedMaterialProjectionSchema.parse(wire);
    expect(toMaterialPreview(parsed)).toMatchObject({
      title: "Материал 1",
      slug: "performance-lesson-1",
      access: "free",
      availability: "available",
      format: "Видео",
      topic: "Platform",
    });
    expect(productJourneyCorpus().items[3]).toMatchObject({
      title: "Материал 4",
      access: "closed",
      availability: "locked",
      format: "Гайд",
    });
  });
});
