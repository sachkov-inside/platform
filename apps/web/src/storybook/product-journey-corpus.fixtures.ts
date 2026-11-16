import {
  readingMaterials,
  readingProduct,
  readingTopic,
} from "../../../../scenarios/reading.mjs";
import type { MaterialPreview } from "@/entities/material";
import type { PublishedProductResult } from "@/features/library-discovery";

/** Presentation adapter for the shared synthetic reading scenario. */
export function productJourneyCorpus(): Extract<
  PublishedProductResult,
  { kind: "ready" }
> {
  const items = readingMaterials.map((material): MaterialPreview => ({
    materialId: material.materialId,
    slug: material.slug,
    title: material.title,
    summary: material.summary,
    access: material.access,
    availability: material.access === "free" ? "available" : "locked",
    format: material.format === "video" ? "Видео" : "Гайд",
    formatSlug: material.format,
    publishedAt: material.publishedAt,
    topic: readingTopic.name,
    topicSlug: readingTopic.slug,
    tags: [],
    productMemberships: [],
  }));
  return {
    kind: "ready",
    discoveryKind: "product",
    chapters: [],
    hasNext: false,
    reference: {
      name: readingProduct.name,
      slug: readingProduct.slug,
      summary: "От идеи до выпуска",
    },
    items,
    relatedProduct: [],
    topics: [],
  };
}
