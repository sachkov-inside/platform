import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import {
  isActiveReviewState,
  practiceStatusOfReviews,
  reviewStates,
} from "../../domain/practice-review.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { practiceIdSchema, toViews } from "../../shared/practice-reviews.js";
import {
  practiceReviewRowSelect,
  practiceReviewViewSchema,
} from "../../shared/practice-review-view.js";

export const practiceConversationSchema = z.strictObject({
  practice: z
    .strictObject({
      practiceId: z.string(),
      title: z.string(),
      contextVersion: z.hash("sha256"),
      criteria: z.array(
        z.strictObject({ id: z.string(), requirement: z.string() }),
      ),
    })
    .nullable(),
  status: z.enum(["not_started", "in_review", "needs_work", "accepted"]),
  activeReview: practiceReviewViewSchema.nullable(),
  messages: z.array(
    z.strictObject({
      id: z.uuid(),
      role: z.enum(["participant", "assistant"]),
      kind: z.enum(["text", "candidate_question", "review_result"]),
      text: z.string().nullable(),
      review: practiceReviewViewSchema.nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type PracticeConversation = z.infer<typeof practiceConversationSchema>;

export type ReadPracticeConversationResult =
  | { readonly ok: true; readonly value: PracticeConversation }
  | {
      readonly ok: false;
      readonly error:
        CourseAssistantError | { readonly code: "practice_unavailable" };
    };

/**
 * Assistant Conversation практики: сообщения, идущая проверка и Practice Status. Критерии
 * задания читаются из Materials при каждом показе; помощник их не копирует.
 */
export async function readPracticeConversation(
  dependencies: CourseAssistantDependencies,
  query: { readonly accountId: string; readonly practiceId: string },
): Promise<ReadPracticeConversationResult> {
  const accountId = z.uuid().safeParse(query.accountId);
  const practiceId = practiceIdSchema.safeParse(query.practiceId);
  if (!accountId.success || !practiceId.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  try {
    const practice = await dependencies.practices.describe({
      accountId: account,
      practiceId: practiceId.data,
    });
    if (!practice.ok && practice.reason === "dependency_unavailable")
      return dependencyUnavailable;
    const conversation =
      await dependencies.prisma.assistantConversation.findUnique({
        where: {
          accountId_practiceId: {
            accountId: account,
            practiceId: practiceId.data,
          },
        },
        select: { id: true },
      });
    // История беседы остаётся видна и после потери доступа к заданию; новую беседу без доступа
    // не открыть.
    if (!practice.ok && conversation === null)
      return { ok: false, error: { code: "practice_unavailable" } };
    const reviewRows =
      conversation === null
        ? []
        : await dependencies.prisma.practiceReview.findMany({
            where: { conversationId: conversation.id },
            orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
            select: practiceReviewRowSelect,
          });
    const reviews = await toViews(dependencies.prisma, reviewRows);
    const byId = new Map(reviews.map((review) => [review.id, review]));
    const messages =
      conversation === null
        ? []
        : await dependencies.prisma.assistantMessage.findMany({
            where: { conversationId: conversation.id },
            orderBy: { position: "asc" },
            select: {
              id: true,
              role: true,
              kind: true,
              text: true,
              reviewId: true,
              createdAt: true,
            },
          });
    const active =
      reviews.find(({ state }) => isActiveReviewState(state)) ?? null;
    return {
      ok: true,
      value: {
        practice: practice.ok
          ? {
              practiceId: practice.value.practiceId,
              title: practice.value.title,
              contextVersion: practice.value.contextVersion,
              criteria: [...practice.value.criteria],
            }
          : null,
        status: practiceStatusOfReviews(
          reviewRows.map((row) => ({
            state: z.enum(reviewStates).parse(row.state),
            practiceStatus:
              row.practiceStatus === "accepted" ||
              row.practiceStatus === "needs_work"
                ? row.practiceStatus
                : null,
          })),
        ),
        activeReview: active,
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role === "assistant" ? "assistant" : "participant",
          kind: z
            .enum(["text", "candidate_question", "review_result"])
            .parse(message.kind),
          text: message.text,
          // Текст участника тоже связан с проверкой, но показывается только сообщение помощника.
          review:
            message.role === "assistant" && message.reviewId !== null
              ? (byId.get(message.reviewId) ?? null)
              : null,
          createdAt: message.createdAt.toISOString(),
        })),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "readPracticeConversation" },
      error,
      dependencyUnavailable,
    );
  }
}
