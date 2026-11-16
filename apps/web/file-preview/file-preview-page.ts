import { z } from "zod";

import { productTaskPageSchema } from "@/_pages/product-task";
import {
  glossaryTermSchema,
  renderedBlockSchema,
} from "@/entities/material.model";
import { productChapterTaskSchema } from "@/entities/product-task.model";
import { materialDifficultySchema } from "@/shared/api/material-lesson-facts";

const accessSchema = z.enum(["free", "closed"]);

/** A course of the package as the reader's programme reads it. */
const previewCourseSchema = z.object({
  kind: z.literal("ready"),
  reference: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  chapters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      summary: z.string(),
      materialIds: z.array(z.string()),
      supplementaryMaterialIds: z.array(z.string()),
      tasks: z.array(productChapterTaskSchema),
    }),
  ),
  items: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      materialId: z.string(),
      access: accessSchema,
      availability: z.literal("available"),
    }),
  ),
});

const previewIndexSchema = z.object({
  products: z.array(z.object({ sourceId: z.string(), title: z.string() })),
  materials: z.array(
    z.object({ sourceId: z.string(), title: z.string(), href: z.string() }),
  ),
  tasks: z.array(
    z.object({ sourceId: z.string(), title: z.string(), href: z.string() }),
  ),
});

/**
 * The answer of `/__preview/page`, as `tools/authoring/file-preview.mjs` projects a package page.
 */
export const previewPageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("material"),
    material: z.object({
      access: accessSchema,
      contentVersion: z.number().int(),
      cover: z.null(),
      difficulty: materialDifficultySchema.nullable(),
      outcomes: z.array(z.string()),
      format: z.object({ name: z.string(), slug: z.string() }),
      materialId: z.string(),
      publishedAt: z.string(),
      productMemberships: z.array(
        z.object({
          ordinal: z.number().int(),
          product: z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
          }),
        }),
      ),
      slug: z.string(),
      summary: z.string(),
      tags: z.array(z.object({ name: z.string() })),
      title: z.string(),
      topic: z.object({ name: z.string(), slug: z.string() }),
    }),
    body: z.array(renderedBlockSchema),
    glossaryTerms: z.array(glossaryTermSchema),
    lessonTerms: z.array(glossaryTermSchema),
    primaryVideo: z
      .object({
        videoId: z.string(),
        title: z.string(),
        state: z.literal("ready"),
        chapters: z
          .array(z.object({ start: z.number(), title: z.string() }))
          .exactOptional(),
      })
      .nullable(),
    course: previewCourseSchema.nullable(),
  }),
  z.object({
    kind: z.literal("task"),
    page: productTaskPageSchema,
    course: previewCourseSchema,
  }),
  z.object({ kind: z.literal("index"), index: previewIndexSchema }),
  z.object({ kind: z.literal("missing"), index: previewIndexSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);

export type PreviewPage = z.infer<typeof previewPageSchema>;
export type PreviewIndex = z.infer<typeof previewIndexSchema>;
