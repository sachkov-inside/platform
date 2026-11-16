// @ts-check
import { learningScenario as facts } from "./learning.mjs";

/** @param {string} key */
function lessonId(key) {
  const lesson = facts.lessons.find((candidate) => candidate.key === key);
  if (lesson === undefined) throw new Error(`Unknown synthetic lesson ${key}`);
  return lesson.id;
}

/** Wire adapter for the backend boundary; no web mapper supplies its expected values.
 * @param {"holder" | "learner"} role
 */
export function learningHttpProduct(role) {
  const entitled = role === "holder";
  return {
    kind: "product",
    hasNext: false,
    reference: {
      ...facts.product,
      cover: null,
      introduction: null,
      productPage: null,
    },
    topics: [{ ...facts.topic, cover: null }],
    relatedProduct: [],
    chapters: facts.chapters.map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      summary: "",
      materialIds: chapter.lessons.map(lessonId),
      supplementaryMaterialIds: chapter.supplementary.map(lessonId),
      tasks:
        chapter.key === facts.task.chapter
          ? [
              {
                code: facts.task.code,
                title: facts.task.title,
                access: facts.task.access,
                afterMaterialId: lessonId(facts.task.after),
                availability: entitled ? "available" : "locked",
                lastSubmittedAt: null,
              },
            ]
          : [],
    })),
    items: facts.lessons.map((lesson, index) => ({
      materialId: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      summary: lesson.summary,
      access: lesson.access,
      availability:
        entitled || lesson.access === "free" ? "available" : "locked",
      contentVersion: 1,
      cover: null,
      difficulty: "basic",
      format: { ...facts.format },
      outcomes: [],
      primaryVideoId: null,
      publishedAt: facts.fixtureDate,
      productMemberships: [
        {
          ordinal: index + 1,
          product: {
            id: facts.product.id,
            name: facts.product.name,
            slug: facts.product.slug,
          },
          stepGroup: null,
        },
      ],
      tags: [],
      topic: { ...facts.topic },
    })),
  };
}
