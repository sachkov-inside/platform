import { learningScenario as facts } from "../../../../scenarios/learning.mjs";

/** Browser interception speaks the BFF's presentation contract, independently of HTTP mapping. */
export function learningInterceptionCatalog() {
  return {
    kind: "ready",
    facets: {
      formats: [
        {
          ...facts.format,
          count: facts.lessons.length,
          summary: null,
        },
      ],
      products: [],
      topics: [{ ...facts.topic, count: facts.lessons.length, summary: null }],
    },
    items: facts.lessons.map((lesson) => ({
      materialId: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      summary: lesson.summary,
      access: lesson.access,
      availability: lesson.access === "free" ? "available" : "locked",
      format: facts.format.name,
      formatSlug: facts.format.slug,
      topic: facts.topic.name,
      topicSlug: facts.topic.slug,
      tags: [],
      productMemberships: [],
    })),
    nextCursor: null,
    totalCount: facts.lessons.length,
  };
}

/** A browser route may replace the external file response, never an own web module. */
export function learningInterceptionFile() {
  return {
    body: facts.artifact.text,
    contentType: facts.artifact.contentType,
    headers: {
      "content-disposition": `attachment; filename="${facts.artifact.filename}"`,
    },
  };
}
