import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { readPracticeReviewView } from "../../shared/practice-reviews.js";
import type { PracticeReviewView } from "../../shared/practice-review-view.js";

export type ReadPracticeReviewResult =
  | { readonly ok: true; readonly value: PracticeReviewView }
  | {
      readonly ok: false;
      readonly error:
        CourseAssistantError | { readonly code: "review_not_found" };
    };

/** Одна Practice Review участника: за её ходом следит чат, пока проверка идёт. */
export async function readPracticeReview(
  dependencies: CourseAssistantDependencies,
  query: { readonly accountId: string; readonly reviewId: string },
): Promise<ReadPracticeReviewResult> {
  const accountId = z.uuid().safeParse(query.accountId);
  const reviewId = z.uuid().safeParse(query.reviewId);
  if (!accountId.success || !reviewId.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  try {
    const view = await readPracticeReviewView(dependencies.prisma, {
      accountId: account,
      reviewId: reviewId.data,
    });
    return view === null
      ? { ok: false, error: { code: "review_not_found" } }
      : { ok: true, value: view };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "readPracticeReview" },
      error,
      dependencyUnavailable,
    );
  }
}
