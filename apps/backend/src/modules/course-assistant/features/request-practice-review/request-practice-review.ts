import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import { activeReviewStates } from "../../domain/practice-review.js";
import {
  requestedCandidateSchema,
  reviewCandidateSchema,
  requestOf,
  type RequestedCandidate,
} from "../../domain/review-candidate.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { readDataNoticeAcknowledgement } from "../../shared/data-notice-acknowledged.js";
import {
  practiceIdSchema,
  readPracticeReviewView,
} from "../../shared/practice-reviews.js";
import type { PracticeReviewView } from "../../shared/practice-review-view.js";
import { readActiveRepositoryLink } from "../../shared/repository-access.js";

export const requestPracticeReviewSchema = z.strictObject({
  expectedContextVersion: z.hash("sha256"),
  candidate: requestedCandidateSchema.optional(),
  /** Не повторять выбор прошлой проверки: спросить заново, если вариантов несколько. */
  chooseWork: z.boolean().optional(),
});

export type RequestPracticeReviewError =
  | CourseAssistantError
  | { readonly code: "data_notice_required" }
  | { readonly code: "repository_link_required" }
  | { readonly code: "repository_access_revoked" }
  | { readonly code: "practice_unavailable" }
  | {
      readonly code: "practice_context_version_mismatch";
      readonly currentContextVersion: string;
    }
  | { readonly code: "review_unavailable" };

export type RequestPracticeReviewResult =
  | { readonly ok: true; readonly value: PracticeReviewView }
  | { readonly ok: false; readonly error: RequestPracticeReviewError };

/**
 * «Проверить задание» (#788): ставит Practice Review в очередь worker и пишет запрос участника в
 * Assistant Conversation этой практики. Пока проверка идёт, повторный запрос возвращает её же.
 * Контекст задания сверяется с версией, которую видел участник: другая версия не проверяется
 * молча, участник выбирает новую явно.
 */
export async function requestPracticeReview(
  dependencies: CourseAssistantDependencies,
  command: {
    readonly accountId: string;
    readonly practiceId: string;
    readonly expectedContextVersion: string;
    readonly candidate?: RequestedCandidate | undefined;
    readonly chooseWork?: boolean | undefined;
  },
): Promise<RequestPracticeReviewResult> {
  const accountId = z.uuid().safeParse(command.accountId);
  const practiceId = practiceIdSchema.safeParse(command.practiceId);
  const input = requestPracticeReviewSchema.safeParse({
    expectedContextVersion: command.expectedContextVersion,
    candidate: command.candidate,
    chooseWork: command.chooseWork,
  });
  if (!accountId.success || !practiceId.success || !input.success)
    return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  const queue = dependencies.reviewQueue;
  if (queue === null)
    return { ok: false, error: { code: "review_unavailable" } };
  try {
    if (
      (await readDataNoticeAcknowledgement(dependencies.prisma, account)) ===
      null
    )
      return { ok: false, error: { code: "data_notice_required" } };
    const link = await readActiveRepositoryLink(dependencies, account);
    if (link === null)
      return { ok: false, error: { code: "repository_link_required" } };
    if (link.access === "revoked")
      return { ok: false, error: { code: "repository_access_revoked" } };
    if (link.access === "unknown") return dependencyUnavailable;
    const practice = await dependencies.practices.describe({
      accountId: account,
      practiceId: practiceId.data,
    });
    if (!practice.ok) {
      if (practice.reason === "practice_unavailable")
        return { ok: false, error: { code: "practice_unavailable" } };
      return dependencyUnavailable;
    }
    if (practice.value.contextVersion !== input.data.expectedContextVersion)
      return {
        ok: false,
        error: {
          code: "practice_context_version_mismatch",
          currentContextVersion: practice.value.contextVersion,
        },
      };
    const reviewId = await createReview(dependencies, {
      accountId: account,
      practiceId: practiceId.data,
      contextVersion: practice.value.contextVersion,
      installationId: link.installationId,
      repositoryId: link.repository.id,
      repositoryFullName: link.repository.fullName,
      candidate: input.data.candidate ?? null,
      chooseWork: input.data.chooseWork ?? false,
    });
    try {
      await queue.enqueue(reviewId);
    } catch (error) {
      // Проверка уже записана как `queued`: worker подберёт её сам, участник ответ получит.
      reportDependencyFailure(
        { module: "course-assistant", operation: "requestPracticeReview" },
        error,
      );
    }
    const view = await readPracticeReviewView(dependencies.prisma, {
      accountId: account,
      reviewId,
    });
    if (view === null) return dependencyUnavailable;
    return { ok: true, value: view };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "requestPracticeReview" },
      error,
      dependencyUnavailable,
    );
  }
}

async function createReview(
  dependencies: CourseAssistantDependencies,
  input: {
    readonly accountId: string;
    readonly practiceId: string;
    readonly contextVersion: string;
    readonly installationId: number;
    readonly repositoryId: number;
    readonly repositoryFullName: string;
    readonly candidate: RequestedCandidate | null;
    readonly chooseWork: boolean;
  },
): Promise<string> {
  try {
    return await insertReview(dependencies, input);
  } catch (error) {
    // Параллельный запрос той же практики успел раньше: его проверка и есть ответ. Если он
    // создал только беседу, запись повторяется уже с ней.
    if (!isUniqueViolation(error)) throw error;
    const active = await findActiveReview(dependencies.prisma, input);
    return active ?? insertReview(dependencies, input);
  }
}

function insertReview(
  dependencies: CourseAssistantDependencies,
  input: Parameters<typeof createReview>[1],
): Promise<string> {
  const now = dependencies.clock();
  return dependencies.prisma.$transaction(async (transaction) => {
    const conversation = await transaction.assistantConversation.upsert({
      where: {
        accountId_practiceId: {
          accountId: input.accountId,
          practiceId: input.practiceId,
        },
      },
      create: {
        id: randomUUID(),
        accountId: input.accountId,
        practiceId: input.practiceId,
        createdAt: now,
      },
      update: {},
      select: { id: true },
    });
    const active = await findActiveReview(transaction, input);
    if (active !== null) return active;
    const previous = await transaction.practiceReview.findFirst({
      where: {
        accountId: input.accountId,
        practiceId: input.practiceId,
        state: "completed",
      },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      select: { checkedCandidate: true },
    });
    // Повторная проверка без явного выбора смотрит ту же работу, что и прошлая: её ветку или PR.
    const requested =
      input.candidate ??
      (previous === null || input.chooseWork
        ? null
        : requestOf(reviewCandidateSchema.parse(previous.checkedCandidate)));
    // Вид предварительный: worker уточняет его, когда известна работа (повторная — только та же).
    const kind = previous === null ? "initial" : "recheck";
    const id = randomUUID();
    await transaction.practiceReview.create({
      data: {
        id,
        accountId: input.accountId,
        practiceId: input.practiceId,
        conversationId: conversation.id,
        kind,
        state: "queued",
        contextVersion: input.contextVersion,
        installationId: BigInt(input.installationId),
        repositoryId: BigInt(input.repositoryId),
        repositoryFullName: input.repositoryFullName,
        ...(requested === null ? {} : { requestedCandidate: requested }),
        requestedAt: now,
      },
    });
    await transaction.assistantMessage.create({
      data: {
        id: randomUUID(),
        conversationId: conversation.id,
        role: "participant",
        kind: "text",
        text: participantRequest(kind, input.candidate),
        reviewId: id,
        createdAt: now,
      },
    });
    return id;
  });
}

function findActiveReview(
  prisma: Pick<CourseAssistantDependencies["prisma"], "practiceReview">,
  input: { readonly accountId: string; readonly practiceId: string },
): Promise<string | null> {
  return prisma.practiceReview
    .findFirst({
      where: {
        accountId: input.accountId,
        practiceId: input.practiceId,
        state: { in: [...activeReviewStates] },
      },
      select: { id: true },
    })
    .then((row) => row?.id ?? null);
}

function participantRequest(
  kind: "initial" | "recheck",
  candidate: RequestedCandidate | null,
): string {
  const verb = kind === "initial" ? "Проверить задание" : "Проверить снова";
  if (candidate === null) return verb;
  return candidate.kind === "default_branch"
    ? `${verb}: основная ветка`
    : `${verb}: PR #${String(candidate.number)}`;
}

/** `practice_reviews_one_active` или уникальность беседы Account и практики. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "P2002";
}
