import {
  openReadingMaterials,
  readingTopic,
} from "../../../../scenarios/reading.mjs";

/** BFF presentation for the mobile scroll scenario; its viewport needs eighteen cards. */
export function readingInterceptionCatalog() {
  const materials = openReadingMaterials.slice(0, 18);
  return {
    kind: "ready",
    facets: {
      formats: [],
      products: [],
      topics: [{ ...readingTopic, count: materials.length, summary: null }],
    },
    items: materials.map((material) => ({
      materialId: material.materialId,
      access: material.access,
      availability: material.access === "free" ? "available" : "locked",
      format: material.format === "video" ? "Видео" : "Гайд",
      formatSlug: material.format,
      productMemberships: [],
      slug: material.slug,
      summary: material.summary,
      tags: [],
      title: material.title,
      topic: readingTopic.name,
      topicSlug: readingTopic.slug,
    })),
    nextCursor: null,
    totalCount: materials.length,
  };
}
