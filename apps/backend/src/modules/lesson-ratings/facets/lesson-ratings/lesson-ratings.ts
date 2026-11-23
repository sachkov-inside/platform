import {
  type LessonFeedbackPolicy,
  readLessonFeedback,
  submitLessonFeedback,
} from "../../features/lesson-feedback/lesson-feedback.js";
import type { AuthorPolicy } from "../../../../infrastructure/content-authoring/author-policy.js";
import {
  pendingFeedbackNotifications,
  markFeedbackNotificationQueued,
  readFeedbackForNotification,
} from "../../features/lesson-feedback/feedback-notifications.js";
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
  readonly feedbackPolicy: LessonFeedbackPolicy;
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
  readFeedback(query: OwnRating) {
    return readLessonFeedback(this.dependencies, query);
  }

  submitFeedback(query: OwnRating, body: unknown) {
    return submitLessonFeedback(this.dependencies, query, body);
  }

  pendingFeedbackNotifications() {
    return pendingFeedbackNotifications(this.dependencies.prisma);
  }

  markFeedbackNotificationQueued(id: string, at: Date) {
    return markFeedbackNotificationQueued(this.dependencies.prisma, id, at);
  }

  readFeedbackForNotification(id: string) {
    return readFeedbackForNotification(this.dependencies.prisma, id);
  }

  countRatings(query: { readonly actor: string; readonly materialId: string }) {
    return countLessonRatings(this.dependencies, query);
  }
}
