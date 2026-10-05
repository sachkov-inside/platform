import { createHash } from "node:crypto";
import { z } from "zod";

import {
  canonicalJson,
  contractDigest,
} from "../../../../infrastructure/contracts/canonical-digest.js";
import { materialId } from "../../../../infrastructure/contracts/material-id.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import { taskReviewProtocol } from "../../domain/review-protocol.js";
import {
  decideTaskAccess,
  findCurrentTask,
  type CurrentTask,
  type LearningTaskDependencies,
} from "../../shared/learning-task-dependencies.js";
import { scope, systemFailure, type SystemError } from "../../shared/result.js";

// Small bounded tool responses avoid client output truncation; the client reads every part.
const PART_CHARACTERS = 6_000;

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
  if (!parsed.success)
    return failure({ code: "invalid_request_shape" });
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
    const serialized = canonicalJson({
      contextVersion,
      payload: {
        task: {
          code: task.code,
          title: task.title,
          access: task.access,
          guide: { slug: guide.slug, name: guide.name },
          chapter: { name: chapter.name },
          version: task.version,
          definition: task.definition,
        },
        reviewProtocol: taskReviewProtocol,
        relatedMaterials,
        submission: {
          tool: "learning_task_submit",
          taskVersion: task.version,
          accepting: dependencies.submissionsEnabled,
        },
      },
      terminalMarker: `END_CONTEXT:${contextVersion}`,
    });
    const contentSha256 = sha256(serialized);
    // Title, related Materials or their availability can change without a new Task Version.
    // Never splice two snapshots under one context version.
    if (
      request.expectedContentSha256 !== undefined &&
      request.expectedContentSha256 !== contentSha256
    )
      return failure({ code: "task_content_changed" });
    const characters = Array.from(serialized);
    const partCount = Math.ceil(characters.length / PART_CHARACTERS);
    if (request.part >= partCount)
      return failure({ code: "invalid_context_part", partCount });
    const data = characters
      .slice(request.part * PART_CHARACTERS, (request.part + 1) * PART_CHARACTERS)
      .join("");
    return {
      ok: true as const,
      value: {
        code: task.code,
        contextVersion,
        format: "canonical-json-parts" as const,
        contentSha256,
        contentBytes: Buffer.byteLength(serialized, "utf8"),
        part: request.part,
        partCount,
        data,
        partSha256: sha256(data),
        complete: partCount === 1,
        endOfContext: request.part === partCount - 1,
        nextPart: request.part === partCount - 1 ? null : request.part + 1,
      },
    };
  } catch (error) {
    return dependencyFailure(scope("readLearningTask"), error, systemFailure(error));
  }
}

/** Published related Materials in authored order with the subject's availability. */
async function readRelatedMaterials(
  dependencies: LearningTaskDependencies,
  subject: Subject,
  sourceIds: readonly string[],
) {
  const found = new Map(
    (await dependencies.directory.materialsBySource(sourceIds)).map((item) => [
      item.sourceId,
      item,
    ]),
  );
  const published = sourceIds.flatMap((sourceId) => {
    const material = found.get(sourceId);
    return material?.published === null || material === undefined
      ? []
      : [{ materialId: material.materialId, ...material.published }];
  });
  if (published.length === 0) return [];
  const availability = await dependencies.contentAccess.checkAvailabilityMany({
    subject,
    operations: published.map((material) => ({
      itemId: material.materialId,
      resource: {
        kind: "material" as const,
        materialId: materialId(material.materialId),
      },
      action: "read" as const,
    })),
    enforcementPoint: "guide_task_read",
    correlationId: published[0]?.materialId ?? "",
  });
  if (!availability.ok) throw new Error(availability.error.code);
  const byId = new Map(
    availability.items.map((item) => [item.itemId, item.availability]),
  );
  return published.map((material) => ({
    slug: material.slug,
    title: material.title,
    availability: byId.get(material.materialId) ?? "unavailable",
  }));
}

function failure<Error extends ReadLearningTaskError>(error: Error) {
  return { ok: false as const, error };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
