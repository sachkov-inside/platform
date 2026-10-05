import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { Subject } from "../../../content-access/index.js";
import { taskReviewProtocol } from "../../domain/review-protocol.js";
import type { LearningTasks } from "../../facets/learning-tasks/learning-tasks.js";
import { learningTasksQuerySchema } from "../../features/list-learning-tasks/list-learning-tasks.js";
import { taskSubmissionsQuerySchema } from "../../features/list-task-submissions/list-task-submissions.js";
import { learningTaskQuerySchema } from "../../features/read-learning-task/read-learning-task.js";
import { taskSubmissionSchema } from "../../features/submit-task/submit-task.js";

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Submission writes, so clients ask the learner before the call; it never removes or replaces
 * anything, and one submission key answers once.
 */
export const taskSubmitAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** What the server `instructions` say about Guide Tasks, beside the learning materials. */
export const learningTaskInstructions =
  "Guide Tasks: learning_tasks_list shows tasks open to the participant; learning_task_read returns a task with its criteria and the review procedure; learning_task_submit records the participant's submission with the agent's review report after the participant confirms it; learning_task_submissions returns their own submissions and the author's feedback. " +
  "This endpoint reads materials and tasks and accepts submissions. It does not grade work, change projects or grant access. Follow the review procedure that learning_task_read and the review_task prompt return.";

/** The `review_task` prompt: the same procedure `learning_task_read` returns, for one task code. */
export function reviewTaskPromptText(code: string): string {
  return [
    `Review my work on the Guide Task with code ${code} by the procedure below, then help me submit it.`,
    `Start with learning_task_read for code ${code}, part 0, and read every part.`,
    `Review procedure v${taskReviewProtocol.version}:`,
    ...taskReviewProtocol.instructions.map(
      (instruction, index) => `${String(index + 1)}. ${instruction}`,
    ),
  ].join("\n");
}

/** Guide Tasks register their tools and prompt on the learner MCP endpoint (#946). */
export function registerLearningTaskTools(
  server: McpServer,
  tasks: LearningTasks,
  subject: Subject,
): void {
  server.registerTool(
    "learning_tasks_list",
    {
      description:
        "List the Guide Tasks open to the participant in programme order: code, Guide, chapter, title, current requirements version and the date of their latest own submission. Optionally within one Guide by its slug. Locked and unpublished tasks are absent.",
      inputSchema: learningTasksQuerySchema,
      annotations: readAnnotations,
    },
    async ({ guideSlug }) =>
      toolResult(await tasks.list({ subject, guideSlug })),
  );
  server.registerTool(
    "learning_task_read",
    {
      description:
        "Read one open Guide Task by code: the current requirements version (situation, result, freedom, required and additional criteria), the review procedure and related materials, in bounded canonical JSON parts. Start with part 0; request every nextPart with expectedContextVersion and expectedContentSha256 from the first response until endOfContext. A version change between parts returns an error; read again from part 0. A task without access answers task_not_available.",
      inputSchema: learningTaskQuerySchema,
      annotations: readAnnotations,
    },
    async (query) => toolResult(await tasks.read({ subject, ...query })),
  );
  server.registerTool(
    "learning_task_submit",
    {
      description:
        "Submit the participant's work on a Guide Task: the review report with exactly one status per criterion of the reviewed version, the participant's note and the optional service mark (repository, branch, commit, uncommitted changes). Call only after the participant has seen and confirmed this exact content. taskVersion is the version you reviewed; a changed version is refused with task_version_changed. Reuse submissionKey only to retry the same content. Platform does not grade the work or fetch the repository.",
      inputSchema: taskSubmissionSchema,
      annotations: taskSubmitAnnotations,
    },
    async (submission) =>
      toolResult(await tasks.submit({ subject, source: "mcp", submission })),
  );
  server.registerTool(
    "learning_task_submissions",
    {
      description:
        "List the participant's own submissions of one Guide Task by code, newest first: requirements version, review report, note, service mark and the author's comment and review mark when they exist.",
      inputSchema: taskSubmissionsQuerySchema,
      annotations: readAnnotations,
    },
    async (query) => toolResult(await tasks.submissions({ subject, ...query })),
  );
  server.registerPrompt(
    "review_task",
    {
      title: "Review and submit a Guide Task",
      description:
        "Start the review of your project against a Guide Task by its code, then submit with your confirmation.",
      argsSchema: z.object({
        code: z.string().min(1).max(120).describe("Guide Task code"),
      }),
    },
    ({ code }) => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: reviewTaskPromptText(code) },
        },
      ],
    }),
  );
}

function toolResult(result: {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: !result.ok,
  };
}
