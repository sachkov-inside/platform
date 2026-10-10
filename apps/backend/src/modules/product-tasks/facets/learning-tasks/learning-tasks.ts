import type { Subject } from "../../../content-access/index.js";
import { listChapterTasks } from "../../features/list-chapter-tasks/list-chapter-tasks.js";
import { listLearningTasks } from "../../features/list-learning-tasks/list-learning-tasks.js";
import { listTaskSubmissions } from "../../features/list-task-submissions/list-task-submissions.js";
import { readLearningTask } from "../../features/read-learning-task/read-learning-task.js";
import { readTaskPage } from "../../features/read-task-page/read-task-page.js";
import { submitTask } from "../../features/submit-task/submit-task.js";
import type { LearningTaskDependencies } from "../../shared/learning-task-dependencies.js";

export const LEARNING_TASKS = Symbol("LEARNING_TASKS");

type Query = { readonly subject: Subject } & Readonly<Record<string, unknown>>;

/**
 * What a learner reaches of Product Tasks: open tasks, one task to review, submission and history;
 * the task page and the tasks of a Product programme (#947).
 */
export interface LearningTasks {
  readonly list: (
    input: Parameters<typeof listLearningTasks>[1],
  ) => ReturnType<typeof listLearningTasks>;
  readonly read: (input: Query) => ReturnType<typeof readLearningTask>;
  readonly submit: (
    input: Parameters<typeof submitTask>[1],
  ) => ReturnType<typeof submitTask>;
  readonly submissions: (
    input: Query,
  ) => ReturnType<typeof listTaskSubmissions>;
  readonly page: (input: Query) => ReturnType<typeof readTaskPage>;
  readonly chapterTasks: (input: Query) => ReturnType<typeof listChapterTasks>;
}

export function assembleLearningTasks(
  dependencies: LearningTaskDependencies,
): LearningTasks {
  return Object.freeze<LearningTasks>({
    list: (input) => listLearningTasks(dependencies, input),
    read: (input) => readLearningTask(dependencies, input),
    submit: (input) => submitTask(dependencies, input),
    submissions: (input) => listTaskSubmissions(dependencies, input),
    page: (input) => readTaskPage(dependencies, input),
    chapterTasks: (input) => listChapterTasks(dependencies, input),
  });
}
