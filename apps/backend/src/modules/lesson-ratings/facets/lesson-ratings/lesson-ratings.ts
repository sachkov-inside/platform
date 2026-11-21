import { lessonFeedback } from "../../features/lesson-feedback/lesson-feedback.js";
import type { AuthorPolicy } from "../../../../infrastructure/content-authoring/author-policy.js";
import { countLessonRatings } from "../../features/count-lesson-ratings/count-lesson-ratings.js";
import {
  clearLessonRating,
  rateLesson,
  type RateLessonCommand,
  type RateLessonDependencies,
} from "../../features/rate-lesson/rate-lesson.js";
import { readLessonRating } from "../../features/read-lesson-rating/read-lesson-rating.js";

export interface LessonRatingsDependencies extends RateLessonDependencies {
  /** Who may count ratings: an Account that manages Materials. */
  readonly authorPolicy: AuthorPolicy;
}

interface OwnRating {
  readonly accountId: string;
  readonly materialId: string;
}

/**
 * Lesson Ratings (#2124): «Как вам урок?», a like or dislike of a signed-in reader that they can
 * change or remove; the author of the lesson counts likes and dislikes.
 */
export class LessonRatings {
  constructor(private readonly dependencies: LessonRatingsDependencies) {}

  readRating(query: OwnRating) {
    return readLessonRating(this.dependencies.prisma, query);
  }
  rate(command: RateLessonCommand) {
    return rateLesson(this.dependencies, command);
  }
  clearRating(command: OwnRating) {
    return clearLessonRating(this.dependencies, command);
  }
  feedback(query: OwnRating, body?: { readonly text: string }) {
    return lessonFeedback(this.dependencies, query, body);
  }
  pendingFeedbackNotifications() {
    return this.dependencies.prisma.lessonFeedback.findMany({
      where: { notificationQueuedAt: null },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: 25,
      select: { id: true, materialId: true, submittedAt: true },
    });
  }

  markFeedbackNotificationQueued(id: string, at: Date) {
    return this.dependencies.prisma.lessonFeedback.updateMany({
      where: { id, notificationQueuedAt: null },
      data: { notificationQueuedAt: at },
    });
  }

  readFeedbackForNotification(id: string) {
    return this.dependencies.prisma.lessonFeedback.findUnique({
      where: { id },
      select: { id: true, materialId: true, submittedAt: true, text: true },
    });
  }

  countRatings(query: { readonly actor: string; readonly materialId: string }) {
    return countLessonRatings(this.dependencies, query);
  }
}
