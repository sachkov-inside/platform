import {
  contentSha256,
  contextPart,
} from "../../../apps/backend/src/infrastructure/contracts/context-parts.js";
import {
  taskDefinitionDigest,
  taskDefinitionSchema,
} from "../../../apps/backend/src/modules/guide-tasks/domain/task-definition.js";
import {
  learningTaskContextVersion,
  serializeLearningTaskContext,
} from "../../../apps/backend/src/modules/guide-tasks/features/read-learning-task/read-learning-task.js";
import type { LearningTasks } from "../../../apps/backend/src/modules/guide-tasks/index.js";
import type { CurrentTask } from "../../../apps/backend/src/modules/guide-tasks/shared/learning-task-dependencies.js";

/**
 * One synthetic open task served by the same context serializer, parts and procedure v3 text as
 * the real `learning_task_read`. Submissions stay in memory, so a trial can prove that none was
 * sent without the learner's confirmation.
 */
export function syntheticLearningTasks(input: {
  readonly code: string;
  readonly definition: unknown;
}) {
  const definition = taskDefinitionSchema.parse(input.definition);
  const task: CurrentTask = {
    id: "00000000-0000-4000-8000-000000000946",
    code: input.code,
    title: "Заявки на консультацию",
    access: "free",
    guideId: "00000000-0000-4000-8000-000000000001",
    chapterId: "00000000-0000-4000-8000-000000000002",
    position: 1,
    relatedMaterialSourceIds: [],
    version: 1,
    definition,
    definitionDigest: taskDefinitionDigest(definition),
  };
  const contextVersion = learningTaskContextVersion(task);
  const serialized = serializeLearningTaskContext({
    task,
    guide: { slug: "synthetic-course", name: "Синтетический курс" },
    chapter: { name: "Глава 1" },
    relatedMaterials: [],
    submissionsEnabled: true,
  });
  const submissions: unknown[] = [];
  const unavailable = {
    ok: false as const,
    error: { code: "task_not_available" as const },
  };
  const tasks: LearningTasks = {
    list: () =>
      Promise.resolve({
        ok: true,
        value: {
          tasks: [
            {
              code: task.code,
              title: task.title,
              guide: { slug: "synthetic-course", name: "Синтетический курс" },
              chapter: { name: "Глава 1", ordinal: 1 },
              position: 1,
              currentVersion: 1,
              lastSubmittedAt: null,
            },
          ],
        },
      }),
    read: (query) => {
      if (query["code"] !== task.code) return Promise.resolve(unavailable);
      const part = typeof query["part"] === "number" ? query["part"] : 0;
      if (
        part > 0 &&
        (query["expectedContextVersion"] !== contextVersion ||
          query["expectedContentSha256"] !== contentSha256(serialized))
      )
        return Promise.resolve({
          ok: false as const,
          error: { code: "task_content_changed" as const },
        });
      const parts = contextPart(serialized, part);
      return Promise.resolve(
        parts.ok
          ? {
              ok: true as const,
              value: {
                code: task.code,
                contextVersion,
                format: "canonical-json-parts" as const,
                ...parts.value,
              },
            }
          : {
              ok: false as const,
              error: {
                code: "invalid_context_part" as const,
                partCount: parts.partCount,
              },
            },
      );
    },
    submit: ({ submission }) => {
      submissions.push(submission);
      return Promise.resolve({
        ok: true,
        value: {
          submissionId: "00000000-0000-4000-8000-000000000003",
          code: task.code,
          taskVersion: 1,
          source: "mcp",
          submittedAt: new Date().toISOString(),
        },
      });
    },
    submissions: () =>
      Promise.resolve({
        ok: true,
        value: { code: task.code, currentVersion: 1, submissions: [] },
      }),
  };
  return { tasks, submissions, contextVersion };
}
