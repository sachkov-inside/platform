import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { LessonRatingsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import {
  deniedMaterialRead,
  type ContentAccess,
} from "../../../content-access/index.js";
import { materialId } from "../../../materials/index.js";
import {
  lessonRatingSchema,
  type LessonRating,
} from "../../domain/lesson-rating.js";

export type RateLessonError =
  | { readonly code: "invalid_request" }
  | { readonly code: "access_denied" }
  | { readonly code: "material_not_found" }
  | { readonly code: "dependency_unavailable" };

export type RateLessonResult =
  | { readonly ok: true; readonly value: LessonRating }
  | { readonly ok: false; readonly error: RateLessonError };

export type ClearLessonRatingResult =
  | { readonly ok: true; readonly value: null }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

export interface RateLessonDependencies {
  readonly prisma: LessonRatingsPrismaClient;
  readonly contentAccess: Pick<ContentAccess, "authorize">;
}

/** `rating` is unvalidated input; the Account comes from the authenticated session. */
export interface RateLessonCommand {
  readonly accountId: string;
  readonly materialId: string;
  readonly rating: unknown;
}

const rateSchema = z
  .object({
    accountId: z.uuid(),
    materialId: z.uuid(),
    rating: lessonRatingSchema,
  })
  .strict();
const ownSchema = z
  .object({ accountId: z.uuid(), materialId: z.uuid() })
  .strict();

/**
 * Sets the reader's rating of a lesson they may read now; a new rating replaces the old one.
 * A rating changes no access, progress or Product Task.
 */
export async function rateLesson(
  dependencies: RateLessonDependencies,
  input: RateLessonCommand,
): Promise<RateLessonResult> {
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const account = parsed.data.accountId.toLowerCase();
  const material = parsed.data.materialId.toLowerCase();
  try {
    const decision = await dependencies.contentAccess.authorize({
      subject: { kind: "account", accountId: accountId(account) },
      action: "read",
      resource: { kind: "material", materialId: materialId(material) },
      enforcementPoint: "lesson_rating",
      correlationId: randomUUID(),
    });
    if (decision.effect === "deny")
      return {
        ok: false,
        error: { code: deniedMaterialRead(decision.reason) },
      };
    const ratedAt = new Date();
    await dependencies.prisma.lessonRating.upsert({
      where: {
        accountId_materialId: { accountId: account, materialId: material },
      },
      create: {
        accountId: account,
        materialId: material,
        rating: parsed.data.rating,
        ratedAt,
      },
      update: { rating: parsed.data.rating, ratedAt },
    });
    return { ok: true, value: parsed.data.rating };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "rateLesson" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}

/**
 * Removes the reader's rating. Removing one's own fact needs no access to the lesson, and a
 * rating that is already gone is the same answer.
 */
export async function clearLessonRating(
  dependencies: Pick<RateLessonDependencies, "prisma">,
  input: { readonly accountId: string; readonly materialId: string },
): Promise<ClearLessonRatingResult> {
  const parsed = ownSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  try {
    await dependencies.prisma.lessonRating.deleteMany({
      where: {
        accountId: parsed.data.accountId.toLowerCase(),
        materialId: parsed.data.materialId.toLowerCase(),
      },
    });
    return { ok: true, value: null };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "clearLessonRating" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
