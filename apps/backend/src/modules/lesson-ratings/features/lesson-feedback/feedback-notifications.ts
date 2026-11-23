import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { LessonRatingsPrisma } from "../../../../infrastructure/prisma/index.js";

type Persistence = Pick<LessonRatingsPrisma, "lessonFeedback">;
const unavailable = {
  ok: false,
  error: { code: "dependency_unavailable" },
} as const;

export async function pendingFeedbackNotifications(prisma: Persistence) {
  try {
    const value = await prisma.lessonFeedback.findMany({
      where: { notificationQueuedAt: null },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: 25,
      select: { id: true, materialId: true, submittedAt: true },
    });
    return { ok: true as const, value };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "pendingFeedbackNotifications" },
      error,
      unavailable,
    );
  }
}

export async function markFeedbackNotificationQueued(
  prisma: Persistence,
  id: string,
  at: Date,
) {
  try {
    await prisma.lessonFeedback.updateMany({
      where: { id, notificationQueuedAt: null },
      data: { notificationQueuedAt: at },
    });
    return { ok: true as const };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "markFeedbackNotificationQueued" },
      error,
      unavailable,
    );
  }
}

export async function readFeedbackForNotification(
  prisma: Persistence,
  id: string,
) {
  try {
    const value = await prisma.lessonFeedback.findUnique({
      where: { id },
      select: { id: true, materialId: true, submittedAt: true, text: true },
    });
    return { ok: true as const, value };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "readFeedbackForNotification" },
      error,
      unavailable,
    );
  }
}
