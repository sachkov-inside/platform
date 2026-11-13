import {
  readExerciseAttempts,
  type ReadExerciseAttemptsQuery,
} from "../../features/read-exercise-attempts/read-exercise-attempts.js";
import {
  recordExerciseAttempt,
  type RecordExerciseAttemptDependencies,
} from "../../features/record-exercise-attempt/record-exercise-attempt.js";
import type { RecordExerciseAttemptCommand } from "../../features/record-exercise-attempt/record-exercise-attempt.contract.js";

/** Exercise Attempts of signed-in readers (#2121): record a checked answer, read the latest ones. */
export class ExerciseAttempts {
  constructor(
    private readonly dependencies: RecordExerciseAttemptDependencies,
  ) {}

  recordAttempt(command: RecordExerciseAttemptCommand) {
    return recordExerciseAttempt(this.dependencies, command);
  }
  readAttempts(query: ReadExerciseAttemptsQuery) {
    return readExerciseAttempts(this.dependencies.prisma, query);
  }
}
