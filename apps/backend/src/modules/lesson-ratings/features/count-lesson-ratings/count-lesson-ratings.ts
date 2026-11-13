import { z } from "zod";
import {
  authorizeManager,
  type AuthorPolicy,
} from "../../../../infrastructure/content-authoring/author-policy.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { LessonRatingsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { LessonRatingCounts } from "../../domain/lesson-rating.js";

export type CountLessonRatingsResult =
  | { readonly ok: true; readonly value: LessonRatingCounts }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "forbidden" }
        | { readonly code: "dependency_unavailable"; readonly retryable: true };
    };

export interface CountLessonRatingsDependencies {
  readonly prisma: LessonRatingsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
}

const querySchema = z
  .object({ actor: z.uuid(), materialId: z.uuid() })
  .strict();

/** Likes and dislikes of one lesson, for an Account that manages Materials. */
export async function countLessonRatings(
  dependencies: CountLessonRatingsDependencies,
  input: { readonly actor: string; readonly materialId: string },
): Promise<CountLessonRatingsResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const authorization = await authorizeManager(
    dependencies.authorPolicy,
    parsed.data.actor,
  );
  if (!authorization.ok) return authorization;
  try {
    const groups = await dependencies.prisma.lessonRating.groupBy({
      by: ["rating"],
      where: { materialId: parsed.data.materialId.toLowerCase() },
      _count: { _all: true },
    });
    const count = (rating: string) =>
      groups.find((group) => group.rating === rating)?._count._all ?? 0;
    return {
      ok: true,
      value: { likes: count("like"), dislikes: count("dislike") },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "countLessonRatings" },
      error,
      {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      },
    );
  }
}
