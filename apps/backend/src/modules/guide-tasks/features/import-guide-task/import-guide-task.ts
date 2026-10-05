import { randomUUID } from "node:crypto";
import { z } from "zod";

import { commandDigest } from "../../../../infrastructure/contracts/canonical-digest.js";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import {
  lockGuideTaskImport,
  type GuideTasksPrisma,
  type GuideTasksPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { GuideDirectory } from "../../../materials/index.js";
import {
  taskDefinitionDigest,
  taskPublicationSchema,
} from "../../domain/task-definition.js";
import type { AuthorPolicy } from "../../ports/author-policy.js";
import { scope, systemFailure, type Result } from "../../shared/result.js";
import {
  applySourceTaskBodySchema,
  sourceTaskSchema,
  taskImportReceiptSchema,
  type ApplySourceTaskOperation,
  type SourceTask,
  type TaskImportError,
  type TaskImportReceipt,
  type TaskValidationError,
  type ValidateSourceTaskOperation,
} from "./import-guide-task.contract.js";

const operation = "apply_guide_task";
const idempotencyKeySchema = z.string().trim().min(1).max(200);

export interface TaskImportDependencies {
  readonly prisma: GuideTasksPrismaClient;
  readonly directory: Pick<GuideDirectory, "guides" | "materialsBySource">;
  readonly authorPolicy: AuthorPolicy;
  readonly clock?: () => Date;
}

type TaskRow = NonNullable<
  Awaited<ReturnType<GuideTasksPrisma["guideTask"]["findUnique"]>>
>;

export function assembleValidateSourceTask(
  dependencies: TaskImportDependencies,
): ValidateSourceTaskOperation {
  return async (input, { actor }) => {
    const parsed = sourceTaskSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const authorized = await authorize(
      dependencies.authorPolicy,
      actor,
      "validateSourceTask",
    );
    if (!authorized.ok) return authorized;
    try {
      const current = await dependencies.prisma.guideTask.findUnique({
        where: { code: parsed.data.code },
      });
      if (current !== null && current.sourceId !== parsed.data.sourceId)
        return { ok: false, error: { code: "source_mismatch" } };
      return {
        ok: true,
        value: {
          valid: true,
          current:
            current === null
              ? null
              : await receiptOf(dependencies.prisma, current),
        },
      };
    } catch (error) {
      return dependencyFailure(
        scope("validateSourceTask"),
        error,
        systemFailure(error),
      );
    }
  };
}

/**
 * Imports one task as its current state: a changed definition digest creates Task Version N+1;
 * title, access, chapter, order, related Materials and publication change only the task revision.
 * An unchanged task writes nothing. The idempotency key, a per-code advisory lock and the expected
 * revision keep a retried or concurrent import from writing twice.
 */
export function assembleApplySourceTask(
  dependencies: TaskImportDependencies,
): ApplySourceTaskOperation {
  const clock = dependencies.clock ?? (() => new Date());
  return async (input, context) => {
    const parsed = applySourceTaskBodySchema.safeParse(input);
    const key = idempotencyKeySchema.safeParse(context.idempotencyKey);
    if (!parsed.success || !key.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const command = parsed.data;
    const authorized = await authorize(
      dependencies.authorPolicy,
      context.actor,
      "applySourceTask",
    );
    if (!authorized.ok) return authorized;
    const placement = await checkPlacement(dependencies.directory, command);
    if (!placement.ok) return placement;
    const fingerprint = commandDigest({ operation, ...command });
    const receiptKey = {
      actorId: context.actor,
      operation,
      idempotencyKey: key.data,
    };
    class Rollback extends Error {
      constructor(readonly importError: TaskImportError) {
        super(importError.code);
      }
    }
    try {
      const receipt = await dependencies.prisma.$transaction(
        async (transaction): Promise<TaskImportReceipt> => {
          const claim = await transaction.guideTaskImportReceipt.createMany({
            data: { ...receiptKey, requestFingerprint: fingerprint },
            skipDuplicates: true,
          });
          if (claim.count === 0) {
            const previous =
              await transaction.guideTaskImportReceipt.findUniqueOrThrow({
                where: { actorId_operation_idempotencyKey: receiptKey },
              });
            if (previous.requestFingerprint !== fingerprint)
              throw new Rollback({ code: "idempotency_conflict" });
            // A historical receipt; the caller reads again to learn the current state.
            return taskImportReceiptSchema.parse(previous.receipt);
          }
          await lockGuideTaskImport(transaction, command.code);
          const current = await transaction.guideTask.findUnique({
            where: { code: command.code },
          });
          if ((current?.revision ?? null) !== command.expectedRevision)
            throw new Rollback({ code: "task_revision_conflict" });
          if (
            current !== null &&
            (current.sourceId !== command.sourceId ||
              current.guideId !== command.guideId)
          )
            throw new Rollback({ code: "source_mismatch" });
          const saved = await saveTask(transaction, current, command, clock());
          await transaction.guideTaskImportReceipt.update({
            where: { actorId_operation_idempotencyKey: receiptKey },
            data: { receipt: saved },
          });
          return saved;
        },
      );
      return { ok: true, value: receipt };
    } catch (error) {
      if (error instanceof Rollback)
        return { ok: false, error: error.importError };
      return dependencyFailure(
        scope("applySourceTask"),
        error,
        systemFailure(error),
      );
    }
  };
}

async function saveTask(
  transaction: GuideTasksPrisma,
  current: TaskRow | null,
  command: SourceTask,
  now: Date,
): Promise<TaskImportReceipt> {
  const digest = taskDefinitionDigest(command.definition);
  const state = {
    chapterId: command.chapterId,
    position: command.position,
    title: command.title,
    access: command.access,
    relatedMaterialSourceIds: [...command.relatedMaterialSourceIds],
    publicationState: command.publicationState,
  };
  const version = {
    definition: command.definition,
    definitionDigest: digest,
    createdAt: now,
    sourceRepository: command.provenance.repository,
    sourceCommit: command.provenance.commit,
    sourcePath: command.provenance.path,
  };
  if (current === null) {
    const taskId = randomUUID();
    await transaction.guideTask.create({
      data: {
        id: taskId,
        code: command.code,
        sourceId: command.sourceId,
        guideId: command.guideId,
        ...state,
        currentVersion: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    await transaction.guideTaskVersion.create({
      data: { taskId, version: 1, ...version },
    });
    return {
      taskId,
      code: command.code,
      revision: 1,
      currentVersion: 1,
      definitionDigest: digest,
      publicationState: state.publicationState,
    };
  }
  const currentVersion = await transaction.guideTaskVersion.findUniqueOrThrow({
    where: {
      taskId_version: { taskId: current.id, version: current.currentVersion },
    },
  });
  const newVersion = currentVersion.definitionDigest !== digest;
  const stateChanged =
    current.chapterId !== state.chapterId ||
    current.position !== state.position ||
    current.title !== state.title ||
    current.access !== state.access ||
    current.publicationState !== state.publicationState ||
    current.relatedMaterialSourceIds.join("\n") !==
      state.relatedMaterialSourceIds.join("\n");
  if (!newVersion && !stateChanged)
    return {
      taskId: current.id,
      code: current.code,
      revision: current.revision,
      currentVersion: current.currentVersion,
      definitionDigest: currentVersion.definitionDigest,
      publicationState: taskPublicationSchema.parse(current.publicationState),
    };
  const versionNumber = current.currentVersion + (newVersion ? 1 : 0);
  if (newVersion)
    await transaction.guideTaskVersion.create({
      data: { taskId: current.id, version: versionNumber, ...version },
    });
  await transaction.guideTask.update({
    where: { id: current.id },
    data: {
      ...state,
      currentVersion: versionNumber,
      revision: current.revision + 1,
      updatedAt: now,
    },
  });
  return {
    taskId: current.id,
    code: current.code,
    revision: current.revision + 1,
    currentVersion: versionNumber,
    definitionDigest: digest,
    publicationState: state.publicationState,
  };
}

/** Guide, chapter and related Materials are judged before the import transaction opens. */
async function checkPlacement(
  directory: TaskImportDependencies["directory"],
  command: SourceTask,
): Promise<Result<undefined, TaskImportError>> {
  try {
    const [guide] = await directory.guides({ ids: [command.guideId] });
    if (guide === undefined || guide.archived)
      return { ok: false, error: { code: "guide_not_found" } };
    if (!guide.chapters.some((chapter) => chapter.id === command.chapterId))
      return { ok: false, error: { code: "chapter_not_found" } };
    const known = new Set(
      (await directory.materialsBySource(command.relatedMaterialSourceIds)).map(
        (material) => material.sourceId,
      ),
    );
    const missing = command.relatedMaterialSourceIds.filter(
      (sourceId) => !known.has(sourceId),
    );
    return missing.length === 0
      ? { ok: true, value: undefined }
      : {
          ok: false,
          error: { code: "related_material_not_found", sourceIds: missing },
        };
  } catch (error) {
    return dependencyFailure(
      scope("applySourceTask"),
      error,
      systemFailure(error),
    );
  }
}

async function authorize(
  policy: AuthorPolicy,
  actor: string,
  operationName: "validateSourceTask" | "applySourceTask",
): Promise<Result<undefined, TaskValidationError>> {
  try {
    return (await policy.canManage(actor))
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: "forbidden" } };
  } catch (error) {
    reportDependencyFailure(scope(operationName), error);
    return {
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    };
  }
}

async function receiptOf(
  prisma: GuideTasksPrisma,
  task: TaskRow,
): Promise<TaskImportReceipt> {
  const version = await prisma.guideTaskVersion.findUniqueOrThrow({
    where: {
      taskId_version: { taskId: task.id, version: task.currentVersion },
    },
  });
  return {
    taskId: task.id,
    code: task.code,
    revision: task.revision,
    currentVersion: task.currentVersion,
    definitionDigest: version.definitionDigest,
    publicationState: taskPublicationSchema.parse(task.publicationState),
  };
}
