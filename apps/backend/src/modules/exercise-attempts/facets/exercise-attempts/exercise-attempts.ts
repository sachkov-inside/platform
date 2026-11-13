import type { AuthorPolicy } from "../../../../infrastructure/content-authoring/author-policy.js";
import {
  readExerciseAttempts,
  type ReadExerciseAttemptsQuery,
} from "../../features/read-exercise-attempts/read-exercise-attempts.js";
import {
  readExerciseStatistics,
  type ReadExerciseStatisticsQuery,
} from "../../features/read-exercise-statistics/read-exercise-statistics.js";
import {
  recordExerciseAttempt,
  type RecordExerciseAttemptDependencies,
} from "../../features/record-exercise-attempt/record-exercise-attempt.js";
import type { RecordExerciseAttemptCommand } from "../../features/record-exercise-attempt/record-exercise-attempt.contract.js";

export interface ExerciseAttemptsDependencies extends RecordExerciseAttemptDependencies {
  /** Who may read author statistics: an Account that manages Materials. */
  readonly authorPolicy: AuthorPolicy;
}

/**
 * Exercise Attempts of signed-in readers (#2121): record a checked answer, read the latest ones;
 * authors read first-try statistics per exercise version (#2124).
 */
export class ExerciseAttempts {
  constructor(private readonly dependencies: ExerciseAttemptsDependencies) {}

  recordAttempt(command: RecordExerciseAttemptCommand) {
    return recordExerciseAttempt(this.dependencies, command);
  }
  readAttempts(query: ReadExerciseAttemptsQuery) {
    return readExerciseAttempts(this.dependencies.prisma, query);
  }
  readStatistics(query: ReadExerciseStatisticsQuery) {
    return readExerciseStatistics(this.dependencies, query);
  }
}
