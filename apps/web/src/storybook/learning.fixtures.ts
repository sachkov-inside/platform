import { learningScenario as facts } from "../../../../scenarios/learning.mjs";
import type { MaterialPreview } from "@/entities/material";
import type { PublishedProductResult } from "@/features/library-discovery";
import type { ReaderProductArtifactsResult } from "@/features/product-artifacts.reader";
import type {
  MaterialReaderMetadata,
  ReaderBlock,
} from "@/_pages/material-reader/model/material-reader-view";

function lessonId(key: string): string {
  const lesson = facts.lessons.find((candidate) => candidate.key === key);
  if (lesson === undefined) throw new Error(`Unknown synthetic lesson ${key}`);
  return lesson.id;
}

/** Presentation adapter, independent of the HTTP adapter and production mapper. */
export function learningProgramme(
  role: "holder" | "learner",
): Extract<PublishedProductResult, { kind: "ready" }> {
  const entitled = role === "holder";
  return {
    kind: "ready",
    discoveryKind: "product",
    hasNext: false,
    reference: { ...facts.product },
    relatedProduct: [],
    topics: [],
    items: facts.lessons.map((lesson, index): MaterialPreview => ({
      materialId: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      summary: lesson.summary,
      access: lesson.access,
      availability:
        entitled || lesson.access === "free" ? "available" : "locked",
      format: facts.format.name,
      formatSlug: facts.format.slug,
      topic: facts.topic.name,
      topicSlug: facts.topic.slug,
      tags: [],
      productMemberships: [
        {
          name: facts.product.name,
          slug: facts.product.slug,
          ordinal: index + 1,
        },
      ],
    })),
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
  };
}

export const learningArtifacts: ReaderProductArtifactsResult = {
  kind: "ready",
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

export const learningReadingStates = new Map(
  facts.lessons.map((lesson) => [
    lesson.id,
    {
      isRead: facts.learning.completed.includes(lesson.key),
      version: 1,
      updateNote: null,
    },
  ]),
);

export const learningContinuation = {
  materialSlug: `synthetic-${facts.learning.started}`,
  label: "Продолжить чтение",
};

/** Preview of the supplementary reader, with its own presentation projection. */
export function learningReferenceReader(): {
  material: MaterialReaderMetadata;
  body: readonly ReaderBlock[];
} {
  const index = facts.lessons.findIndex(
    (lesson) => lesson.key === facts.artifact.material,
  );
  const lesson = facts.lessons[index];
  if (lesson === undefined) throw new Error("Missing learning reference");
  return {
    material: {
      materialId: lesson.id,
      contentVersion: 1,
      cover: null,
      difficulty: "basic",
      outcomes: [],
      format: facts.format,
      publishedAt: facts.fixtureDate,
      access: lesson.access,
      productMemberships: [{ ordinal: index + 1, product: facts.product }],
      slug: lesson.slug,
      summary: lesson.summary,
      tags: [],
      title: lesson.title,
      topic: facts.topic,
    },
    body: [
      {
        kind: "heading",
        level: 2,
        content: [
          { kind: "text", text: facts.reading.openingHeading, marks: [] },
        ],
      },
      {
        kind: "paragraph",
        content: [{ kind: "text", text: lesson.summary, marks: [] }],
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
    ],
  };
}
