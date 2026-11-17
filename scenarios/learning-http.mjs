// @ts-check
import { learningScenario as facts } from "./learning.mjs";

const topic = {
  id: facts.topic.id,
  name: facts.topic.name,
  slug: facts.topic.slug,
};

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
    topics: [{ ...topic, cover: null }],
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
      topic: { ...topic },
    })),
  };
}

/** Reader HTTP adapter; the wire body is independent of the Storybook projection.
 * @param {string} slug @param {"holder" | "learner"} role
 */
export function learningHttpReader(slug, role) {
  const projection = learningHttpProduct(role).items.find(
    (item) => item.slug === slug,
  );
  if (projection === undefined) return undefined;
  if (projection.availability === "locked")
    return {
      kind: "teaser",
      cacheScope: "private-no-store",
      projection,
      access: { availability: "locked", subscriptionOffered: false },
    };
  return {
    kind: "available",
    cacheScope: projection.access === "free" ? "public" : "private-no-store",
    projection,
    primaryVideo: null,
    glossaryTerms: [],
    lessonTerms: [],
    body: {
      schemaVersion: 1,
      blocks: [
        {
          kind: "heading",
          level: 2,
          content: [
            { kind: "text", text: facts.reading.openingHeading, marks: [] },
          ],
        },
        {
          kind: "paragraph",
          content: [{ kind: "text", text: projection.summary, marks: [] }],
        },
        {
          kind: "heading",
          level: 2,
          content: [
            { kind: "text", text: facts.reading.checkHeading, marks: [] },
          ],
        },
        {
          kind: "paragraph",
          content: [
            { kind: "text", text: facts.reading.checkInstruction, marks: [] },
          ],
        },
        ...(facts.lessons.find((item) => item.key === facts.artifact.material)
          ?.slug === slug
          ? [
              {
                kind: "paragraph",
                content: [
                  {
                    kind: "text",
                    text: facts.artifact.downloadLabel,
                    marks: [
                      {
                        kind: "link",
                        href: `/api/products/${facts.product.id}/artifact-sources/${encodeURIComponent(facts.artifact.sourceId)}/file`,
                      },
                    ],
                  },
                ],
              },
            ]
          : []),
      ],
    },
  };
}

/** Current file metadata, as exposed by the real Products API. */
export function learningHttpArtifacts() {
  return {
    artifacts: [
      {
        artifactId: facts.artifact.id,
        sourceId: facts.artifact.sourceId,
        title: facts.artifact.title,
        purpose: facts.artifact.purpose,
        availability: "available",
        content: {
          kind: "file",
          filename: facts.artifact.filename,
          contentType: facts.artifact.contentType,
          size: new TextEncoder().encode(facts.artifact.text).length,
        },
        updatedAt: facts.fixtureDate,
        version: 1,
      },
    ],
  };
}
