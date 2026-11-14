import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { LessonRatingsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  lessonRatingSchema,
  type LessonRating,
} from "../../domain/lesson-rating.js";

export type ReadLessonRatingResult =
  | { readonly ok: true; readonly value: LessonRating | null }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

const querySchema = z
  .object({ accountId: z.uuid(), materialId: z.uuid() })
  .strict();

/**
 * The reader's own rating of a lesson, or null. Reading one's own rating needs no access to
 * the lesson: it is the reader's own fact.
 */
export async function readLessonRating(
  prisma: LessonRatingsPrismaClient,
  input: { readonly accountId: string; readonly materialId: string },
): Promise<ReadLessonRatingResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const row = await prisma.lessonRating.findUnique({
      where: {
        accountId_materialId: {
          accountId: parsed.data.accountId.toLowerCase(),
          materialId: parsed.data.materialId.toLowerCase(),
        },
      },
      select: { rating: true },
    });
    return {
      ok: true,
      value: row === null ? null : lessonRatingSchema.parse(row.rating),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "readLessonRating" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
