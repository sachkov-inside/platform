import { z } from "zod";

import {
  canonicalJson,
  contractDigest,
} from "../../../../infrastructure/contracts/canonical-digest.js";
import {
  contentSha256,
  contextPart,
} from "../../../../infrastructure/contracts/context-parts.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import { taskReviewProtocol } from "../../domain/review-protocol.js";
import {
  decideTaskAccess,
  findCurrentTask,
  readRelatedMaterials,
  type CurrentTask,
  type LearningTaskDependencies,
} from "../../shared/learning-task-dependencies.js";
import { scope, systemFailure, type SystemError } from "../../shared/result.js";

export const learningTaskQuerySchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    expectedContextVersion: z.hash("sha256").optional(),
    expectedContentSha256: z.hash("sha256").optional(),
    part: z.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  .refine(
    (value) =>
      value.part === 0 ||
      (value.expectedContextVersion !== undefined &&
        value.expectedContentSha256 !== undefined),
    "Later parts require expectedContextVersion and expectedContentSha256",
  );

export type ReadLearningTaskError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "task_not_available" }
  | {
      readonly code: "task_context_version_mismatch";
      readonly expectedContextVersion: string;
      readonly currentContextVersion: string;
    }
  | { readonly code: "task_content_changed" }
  | { readonly code: "invalid_context_part"; readonly partCount: number }
  | SystemError;

/** The version pin of a read: the task, its requirements and the review procedure. */
export function learningTaskContextVersion(task: CurrentTask): string {
  return contractDigest({
    taskId: task.id,
    code: task.code,
    version: task.version,
    definitionDigest: task.definitionDigest,
    reviewProtocolVersion: taskReviewProtocol.version,
  });
}

/**
 * The context one task read serializes: the task with its current Task Version, procedure v3,
 * related Materials and whether submission is open, closed by its end marker.
 */
export function serializeLearningTaskContext(input: {
  readonly task: CurrentTask;
  readonly guide: { readonly slug: string; readonly name: string };
  readonly chapter: { readonly name: string };
  readonly relatedMaterials: readonly {
    readonly slug: string;
    readonly title: string;
    readonly availability: string;
  }[];
  readonly submissionsEnabled: boolean;
}): string {
  const { task } = input;
  const contextVersion = learningTaskContextVersion(task);
  return canonicalJson({
    contextVersion,
    payload: {
      task: {
        code: task.code,
        title: task.title,
        access: task.access,
        guide: input.guide,
        chapter: input.chapter,
        version: task.version,
        definition: task.definition,
      },
      reviewProtocol: taskReviewProtocol,
      relatedMaterials: input.relatedMaterials,
      submission: {
        tool: "learning_task_submit",
        taskVersion: task.version,
        accepting: input.submissionsEnabled,
      },
    },
    terminalMarker: `END_CONTEXT:${contextVersion}`,
  });
}

/**
 * The current requirements of one open task with the review procedure v3 and its related
 * Materials, as canonical JSON in bounded parts. Part 0 pins `contextVersion` and `contentSha256`;
 * every later part must name both, and a task that changed between parts answers with an error,
 * never with a mix of two versions.
 */
export async function readLearningTask(
  dependencies: LearningTaskDependencies,
  input: { readonly subject: Subject } & Readonly<Record<string, unknown>>,
) {
  const { subject, ...query } = input;
  const parsed = learningTaskQuerySchema.safeParse(query);
  if (!parsed.success) return failure({ code: "invalid_request_shape" });
  const request = parsed.data;
  try {
    const task = await findCurrentTask(dependencies.prisma, request.code);
    if (task === null) return failure({ code: "task_not_available" });
    const access = await decideTaskAccess(
      dependencies.contentAccess,
      subject,
      task.id,
      "guide_task_read",
    );
    if (access === "unavailable")
      return failure({ code: "dependency_unavailable", retryable: true });
    if (access === "closed") return failure({ code: "task_not_available" });
    const contextVersion = learningTaskContextVersion(task);
    if (
      request.expectedContextVersion !== undefined &&
      request.expectedContextVersion !== contextVersion
    )
      return failure({
        code: "task_context_version_mismatch",
        expectedContextVersion: request.expectedContextVersion,
        currentContextVersion: contextVersion,
      });
    const [guide] = await dependencies.directory.guides({
      ids: [task.guideId],
    });
    const chapter = guide?.chapters.find((item) => item.id === task.chapterId);
    if (guide === undefined || chapter === undefined)
      return failure({ code: "task_not_available" });
    const relatedMaterials = await readRelatedMaterials(
      dependencies,
      subject,
      task.relatedMaterialSourceIds,
    );
    const serialized = serializeLearningTaskContext({
      task,
      guide: { slug: guide.slug, name: guide.name },
      chapter: { name: chapter.name },
      relatedMaterials,
      submissionsEnabled: dependencies.submissionsEnabled,
    });
    // Title, related Materials or their availability can change without a new Task Version.
    // Never splice two snapshots under one context version.
    if (
      request.expectedContentSha256 !== undefined &&
      request.expectedContentSha256 !== contentSha256(serialized)
    )
      return failure({ code: "task_content_changed" });
    const parts = contextPart(serialized, request.part);
    if (!parts.ok)
      return failure({
        code: "invalid_context_part",
        partCount: parts.partCount,
      });
    return {
      ok: true as const,
      value: {
        code: task.code,
        contextVersion,
        format: "canonical-json-parts" as const,
        ...parts.value,
      },
    };
  } catch (error) {
    return dependencyFailure(
      scope("readLearningTask"),
      error,
      systemFailure(error),
    );
  }
}

function failure<Error extends ReadLearningTaskError>(error: Error) {
  return { ok: false as const, error };
}
