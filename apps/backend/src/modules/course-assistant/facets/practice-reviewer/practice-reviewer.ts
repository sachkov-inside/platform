import { resumeStalledReviews } from "../../features/resume-stalled-reviews/resume-stalled-reviews.js";
import {
  runPracticeReview,
  type PracticeReviewerDependencies,
} from "../../features/run-practice-review/run-practice-review.js";

/**
 * Worker помощника курса (#788): выполняет Practice Review из очереди и подбирает проверки,
 * чья постановка потерялась или чей запуск прервался.
 */
export class PracticeReviewer {
  constructor(private readonly dependencies: PracticeReviewerDependencies) {}

  run(command: { readonly reviewId: string }) {
    return runPracticeReview(this.dependencies, command);
  }
  resumeStalled() {
    return resumeStalledReviews(this.dependencies);
  }
}
