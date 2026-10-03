import { resumeStalledReviews } from "../../features/resume-stalled-reviews/resume-stalled-reviews.js";
import {
  removeLeftoverSnapshots,
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
  /** Вызывается при запуске worker: ни одна проверка этого процесса ещё не идёт. */
  removeLeftoverSnapshots() {
    return removeLeftoverSnapshots(this.dependencies);
  }
  resumeStalled() {
    return resumeStalledReviews(this.dependencies);
  }
}
