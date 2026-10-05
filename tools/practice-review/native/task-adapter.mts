import { createHash } from "node:crypto";

import {
  canonicalJson,
  contractDigest,
} from "../../../apps/backend/src/infrastructure/contracts/canonical-digest.js";
import { taskReviewProtocol } from "../../../apps/backend/src/modules/guide-tasks/domain/review-protocol.js";
import {
  taskDefinitionDigest,
  taskDefinitionSchema,
} from "../../../apps/backend/src/modules/guide-tasks/domain/task-definition.js";
import type { LearningTasks } from "../../../apps/backend/src/modules/guide-tasks/index.js";

const PART_CHARACTERS = 6_000;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * One synthetic open task served in the same canonical JSON parts and with the same procedure v3
 * text as the real `learning_task_read`. It stores submissions in memory, so a trial can prove that
 * none was sent without the learner's confirmation.
 */
export function syntheticLearningTasks(input: {
  readonly code: string;
  readonly definition: unknown;
}) {
  const definition = taskDefinitionSchema.parse(input.definition);
  const definitionDigest = taskDefinitionDigest(definition);
  const contextVersion = contractDigest({
    taskId: "synthetic",
    code: input.code,
    version: 1,
    definitionDigest,
    reviewProtocolVersion: taskReviewProtocol.version,
  });
  const serialized = canonicalJson({
    contextVersion,
    payload: {
      task: {
        code: input.code,
        title: "Заявки на консультацию",
        access: "free",
        guide: { slug: "synthetic-course", name: "Синтетический курс" },
        chapter: { name: "Глава 1" },
        version: 1,
        definition,
      },
      reviewProtocol: taskReviewProtocol,
      relatedMaterials: [],
      submission: {
        tool: "learning_task_submit",
        taskVersion: 1,
        accepting: true,
      },
    },
    terminalMarker: `END_CONTEXT:${contextVersion}`,
  });
  const contentSha256 = sha256(serialized);
  const characters = Array.from(serialized);
  const partCount = Math.ceil(characters.length / PART_CHARACTERS);
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
              code: input.code,
              title: "Заявки на консультацию",
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
      if (query["code"] !== input.code) return Promise.resolve(unavailable);
      const part = typeof query["part"] === "number" ? query["part"] : 0;
      if (
        part > 0 &&
        (query["expectedContextVersion"] !== contextVersion ||
          query["expectedContentSha256"] !== contentSha256)
      )
        return Promise.resolve({
          ok: false as const,
          error: { code: "task_content_changed" as const },
        });
      if (!Number.isInteger(part) || part < 0 || part >= partCount)
        return Promise.resolve({
          ok: false as const,
          error: { code: "invalid_context_part" as const, partCount },
        });
      const data = characters
        .slice(part * PART_CHARACTERS, (part + 1) * PART_CHARACTERS)
        .join("");
      return Promise.resolve({
        ok: true as const,
        value: {
          code: input.code,
          contextVersion,
          format: "canonical-json-parts" as const,
          contentSha256,
          contentBytes: Buffer.byteLength(serialized, "utf8"),
          part,
          partCount,
          data,
          partSha256: sha256(data),
          complete: partCount === 1,
          endOfContext: part === partCount - 1,
          nextPart: part === partCount - 1 ? null : part + 1,
        },
      });
    },
    submit: ({ submission }) => {
      submissions.push(submission);
      return Promise.resolve({
        ok: true,
        value: {
          submissionId: "00000000-0000-4000-8000-000000000001",
          code: input.code,
          taskVersion: 1,
          source: "mcp",
          submittedAt: new Date().toISOString(),
        },
      });
    },
    submissions: () =>
      Promise.resolve({
        ok: true,
        value: { code: input.code, currentVersion: 1, submissions: [] },
      }),
  };
  return { tasks, submissions, contextVersion };
}
