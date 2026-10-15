import { randomUUID } from "node:crypto";
import { materialId as checkedMaterialId } from "../../../../infrastructure/contracts/material-id.js";
import type { RenderedMaterialBody } from "@inside/material-blocks";
import {
  taskPageView,
  type TaskPageView,
} from "../../shared/task-page-view.js";
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

interface PracticeContext {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly slug: string;
  readonly title: string;
  readonly body: RenderedMaterialBody;
}

/** The version pin of a read: the task, its requirements and the review procedure. */
export function learningTaskContextVersion(
  task: CurrentTask,
  practice?: PracticeContext,
): string {
  return contractDigest({
    ...(practice === undefined
      ? {}
      : {
          practiceMaterialId: practice.materialId,
          practiceContentVersion: practice.contentVersion,
        }),
    taskId: task.id,
    code: task.code,
    version: task.version,
    definitionDigest: task.definitionDigest,
    reviewProtocolVersion: taskReviewProtocol.version,
  });
}

/**
 * The context one task read serializes: the task with its current Task Version, current procedure,
 * related Materials and whether submission is open, closed by its end marker.
 */
export function serializeLearningTaskContext(input: {
  readonly task: CurrentTask;
  readonly product: { readonly slug: string; readonly name: string };
  readonly chapter: { readonly name: string };
  readonly relatedMaterials: readonly {
    readonly slug: string;
    readonly title: string;
    readonly availability: string;
  }[];
  readonly submissionsEnabled: boolean;
  readonly page?: TaskPageView;
  readonly practice?: PracticeContext;
}): string {
  const { task } = input;
  const contextVersion = learningTaskContextVersion(task, input.practice);
  return canonicalJson({
    contextVersion,
    payload: {
      task: {
        code: task.code,
        title: task.title,
        access: task.access,
        product: input.product,
        chapter: input.chapter,
        version: task.version,
        definition: task.definition,
        ...(input.page === undefined ? {} : { page: input.page }),
      },
      ...(input.practice === undefined
        ? {}
        : { practice: { ...input.practice, complete: true } }),
      reviewProtocol: taskReviewProtocol,
      relatedMaterials: input.relatedMaterials.map(
        ({ slug, title, availability }) => ({ slug, title, availability }),
      ),
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
 * The current requirements of one open task with the review current procedure and its related
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
      "product_task_read",
    );
    if (access === "unavailable")
      return failure({ code: "dependency_unavailable", retryable: true });
    if (access === "closed") return failure({ code: "task_not_available" });
    let practice: PracticeContext | undefined;
    if (task.embeddedMaterialId !== null) {
      if (dependencies.materialReader === undefined)
        return failure({ code: "dependency_unavailable", retryable: true });
      const [material] = await dependencies.directory.materialsByIds([
        task.embeddedMaterialId,
      ]);
      if (material?.published == null)
        return failure({ code: "task_not_available" });
      const [placement] = await dependencies.directory.placements(
        task.productId,
        [material.sourceId],
      );
      if (placement?.chapterId !== task.chapterId)
        return failure({ code: "task_not_available" });
      const lesson = await dependencies.materialReader.read({
        subject,
        slug: material.published.slug,
      });
      if (!lesson.ok)
        return lesson.error.code === "dependency_unavailable"
          ? failure({ code: "dependency_unavailable", retryable: true })
          : failure({ code: "task_not_available" });
      if (lesson.value.kind !== "available")
        return failure({ code: "task_not_available" });
      const projection = lesson.value.projection;
      practice = {
        materialId: projection.materialId,
        contentVersion: projection.contentVersion,
        slug: projection.slug,
        title: projection.title,
        body: lesson.value.body,
      };
    }
    const contextVersion = learningTaskContextVersion(task, practice);
    if (
      request.expectedContextVersion !== undefined &&
      request.expectedContextVersion !== contextVersion
    )
      return failure({
        code: "task_context_version_mismatch",
        expectedContextVersion: request.expectedContextVersion,
        currentContextVersion: contextVersion,
      });
    const [product] = await dependencies.directory.products({
      ids: [task.productId],
    });
    const chapter = product?.chapters.find(
      (item) => item.id === task.chapterId,
    );
    if (product === undefined || chapter === undefined)
      return failure({ code: "task_not_available" });
    const relatedMaterials = await readRelatedMaterials(
      dependencies,
      subject,
      task.relatedMaterialSourceIds,
    );
    const view = await taskPageView(dependencies, task, product.slug);
    if (!view.ok) return view;
    const serialized = serializeLearningTaskContext({
      task: { ...task, definition: view.value.definition },
      ...(view.value.page === undefined ? {} : { page: view.value.page }),
      product: { slug: product.slug, name: product.name },
      chapter: { name: chapter.name },
      relatedMaterials,
      submissionsEnabled: dependencies.submissionsEnabled,
      ...(practice === undefined ? {} : { practice }),
    });
    // Title, related Materials or their availability can change without a new Task Version.
    // Never splice two snapshots under one context version.
    if (
      request.expectedContentSha256 !== undefined &&
      request.expectedContentSha256 !== contentSha256(serialized)
    )
      return failure({ code: "task_content_changed" });
    if (practice !== undefined) {
      const current = await dependencies.prisma.productTask.findUnique({
        where: { code: task.code },
      });
      if (
        current?.embeddedMaterialId !== practice.materialId ||
        current.currentVersion !== task.version
      )
        return failure({ code: "task_content_changed" });
      const taskAccess = await decideTaskAccess(
        dependencies.contentAccess,
        subject,
        task.id,
        "product_task_read",
      );
      if (taskAccess === "unavailable")
        return failure({ code: "dependency_unavailable", retryable: true });
      if (taskAccess !== "open") return failure({ code: "task_not_available" });
      // All dependent reads precede this final lesson access/version guard.
      const currentLesson = await dependencies.contentAccess.authorize({
        subject,
        resource: {
          kind: "material",
          materialId: checkedMaterialId(practice.materialId),
        },
        action: "read",
        enforcementPoint: "mcp_material_read",
        correlationId: randomUUID(),
      });
      if (currentLesson.effect !== "allow")
        return currentLesson.reason === "dependency_unavailable"
          ? failure({ code: "dependency_unavailable", retryable: true })
          : failure({ code: "task_not_available" });
      if (currentLesson.checkedContentVersion !== practice.contentVersion)
        return failure({ code: "task_content_changed" });
    }
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
