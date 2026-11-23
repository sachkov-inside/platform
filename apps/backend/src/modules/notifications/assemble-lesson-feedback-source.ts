import type { NotificationsPrisma } from "../../infrastructure/prisma/index.js";
import { digestNotificationPayload } from "../../infrastructure/notification-transport/wire.js";
import type { LessonRatings } from "../lesson-ratings/index.js";
import { materialId, type MaterialContent } from "../materials/index.js";
import type { NotificationEvent } from "./domain/notification-wire.js";
import type { NotificationSource } from "./ports/notification-sources.js";

export const lessonFeedbackLane = "lessonFeedback";
const FEEDBACK_DELIVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function feedbackEvent(
  feedback: { id: string; materialId: string; submittedAt: Date },
  accountRef: string,
): NotificationEvent {
  return {
    contractVersion: "inside.notification-event.v1",
    eventType: "lesson-feedback.submitted",
    kind: "lesson_feedback_submitted",
    messageId: feedback.id,
    occurrenceRef: feedback.id,
    sourceRef: feedback.materialId,
    sourceRevision: 1,
    accountRef,
    occurredAt: feedback.submittedAt.toISOString(),
    notAfter: new Date(
      feedback.submittedAt.getTime() + FEEDBACK_DELIVERY_WINDOW_MS,
    ).toISOString(),
  };
}

export function assembleLessonFeedbackSource(
  ratings: Pick<
    LessonRatings,
    | "pendingFeedbackNotifications"
    | "markFeedbackNotificationQueued"
    | "readFeedbackForNotification"
  >,
  materials: Pick<MaterialContent, "findPublishedReaderPath">,
  recipient: string | undefined,
) {
  return {
    async queuePending(
      prisma: Pick<NotificationsPrisma, "notificationInbox">,
      now: Date,
    ) {
      if (recipient === undefined) return;
      const pending = await ratings.pendingFeedbackNotifications();
      if (!pending.ok) throw new Error("lesson_feedback_outbox_unavailable");
      for (const feedback of pending.value) {
        const payload = JSON.stringify(feedbackEvent(feedback, recipient));
        // A crash after insertion leaves the review pending. The same inbox key makes replay safe.
        await prisma.notificationInbox.createMany({
          data: {
            scope: lessonFeedbackLane,
            lane: lessonFeedbackLane,
            messageId: feedback.id,
            payload,
            digest: digestNotificationPayload(payload),
            receivedAt: now,
            nextAttemptAt: now,
          },
          skipDuplicates: true,
        });
        const queued = await ratings.markFeedbackNotificationQueued(
          feedback.id,
          now,
        );
        if (!queued.ok)
          throw new Error("lesson_feedback_outbox_ack_unavailable");
      }
    },
    async resolve(event: NotificationEvent): Promise<NotificationSource> {
      if (recipient === undefined) return { status: "unavailable" };
      if (event.accountRef !== recipient) return { status: "superseded" };
      const feedback = await ratings.readFeedbackForNotification(
        event.occurrenceRef,
      );
      if (!feedback.ok) return { status: "unavailable" };
      if (feedback.value === null) return { status: "superseded" };
      const review = feedback.value;
      const readerPath = await materials.findPublishedReaderPath(
        materialId(review.materialId),
      );
      if (!readerPath.ok) return { status: "unavailable" };
      if (readerPath.value === null) return { status: "superseded" };
      return {
        status: "current",
        event: feedbackEvent(review, recipient),
        accountId: recipient,
        content: {
          category: "subscription",
          kind: "lesson_feedback_submitted",
        },
        title: "Отзыв об уроке",
        readerPath: readerPath.value,
        feedbackText: review.text,
      };
    },
  };
}
