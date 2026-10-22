import type { MaterialAssets } from "../../../assets/index.js";
import { preProductCommand } from "../../../../infrastructure/contracts/pre-product-command.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  commandDigest,
  replayFingerprint,
} from "../../../../infrastructure/contracts/canonical-digest.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockProductTaskImport,
  type ProductTasksPrisma,
  type ProductTasksPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { ProductDirectory } from "../../../materials/index.js";
import {
  taskDefinitionDigest,
  taskPublicationSchema,
} from "../../domain/task-definition.js";
import type { AuthorPolicy } from "../../ports/author-policy.js";
import { authorizeAuthor } from "../../shared/authorize-author.js";
import { scope, systemFailure, type Result } from "../../shared/result.js";
import {
  applySourceTaskBodySchema,
  sourceTaskSchema,
  taskImportReceiptSchema,
  type ApplySourceTaskOperation,
  type SourceTask,
  type TaskImportError,
  type TaskImportReceipt,
  type ValidateSourceTaskOperation,
} from "./import-product-task.contract.js";

const operation = "apply_product_task";
const idempotencyKeySchema = z.string().trim().min(1).max(200);

export interface TaskImportDependencies {
  readonly prisma: ProductTasksPrismaClient;
  readonly directory: Pick<
    ProductDirectory,
    "products" | "materialsBySource" | "placements" | "lockPrimaryPlacement"
  >;
  readonly authorPolicy: AuthorPolicy;
  readonly clock?: () => Date;
  readonly assets?: Pick<MaterialAssets, "loadAccessFacts">;
}

type TaskRow = NonNullable<
  Awaited<ReturnType<ProductTasksPrisma["productTask"]["findUnique"]>>
>;

export function assembleValidateSourceTask(
  dependencies: TaskImportDependencies,
): ValidateSourceTaskOperation {
  return async (input, { actor }) => {
    const parsed = sourceTaskSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const authorized = await authorizeAuthor(
      dependencies.authorPolicy,
      actor,
      "validateSourceTask",
    );
    if (!authorized.ok) return authorized;
    try {
      const [migration] = await dependencies.directory.materialsBySource([
        parsed.data.sourceId,
      ]);
      const current = await dependencies.prisma.productTask.findUnique({
        where: { code: parsed.data.code },
      });
      if (current !== null && current.sourceId !== parsed.data.sourceId)
        return { ok: false, error: { code: "source_mismatch" } };
      return {
        ok: true,
        value: {
          valid: true,
          migration:
            migration === undefined
              ? null
              : { materialId: migration.materialId },
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
 * title, access, chapter, order, the Material it follows, related Materials and publication change
 * only the task revision.
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
    const authorized = await authorizeAuthor(
      dependencies.authorPolicy,
      context.actor,
      "applySourceTask",
    );
    if (!authorized.ok) return authorized;
    const placement = await checkPlacement(dependencies.directory, command);
    if (!placement.ok) return placement;
    const references = Object.values(command.resolvedImages);
    if (references.length > 0) {
      try {
        const [owner] = await dependencies.directory.materialsBySource([
          `inside-task-page:${command.sourceId}`,
        ]);
        const facts = await dependencies.assets?.loadAccessFacts([
          ...new Set(references.map((item) => item.assetId)),
        ]);
        if (facts === undefined || !facts.ok)
          return {
            ok: false,
            error: { code: "dependency_unavailable", retryable: true },
          };
        if (
          owner === undefined ||
          references.some(
            (reference) =>
              reference.materialId !== owner.materialId ||
              !facts.value.some(
                (fact) =>
                  fact.assetId === reference.assetId &&
                  fact.materialId === owner.materialId,
              ),
          )
        )
          return { ok: false, error: { code: "source_mismatch" } };
      } catch (error) {
        return dependencyFailure(
          scope("applySourceTask"),
          error,
          systemFailure(error),
        );
      }
    }
    const envelope = preProductCommand({ operation, ...command });
    const { resolvedLinks, resolvedImages, ...legacyCommand } = command;
    // Receipts before Task pages did not include these default-empty maps. Only page-free v1
    // commands can replay that form; every authored field still contributes to its digest.
    const legacyEnvelope =
      command.definition.schemaVersion === 1 &&
      command.page === undefined &&
      command.pageBody === undefined &&
      Object.keys(resolvedLinks).length === 0 &&
      Object.keys(resolvedImages).length === 0
        ? preProductCommand({ operation, ...legacyCommand })
        : envelope;
    const fingerprint = replayFingerprint(
      envelope,
      commandDigest(legacyEnvelope),
    );
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
          const claim = await transaction.productTaskImportReceipt.createMany({
            data: { ...receiptKey, requestFingerprint: fingerprint.digest },
            skipDuplicates: true,
          });
          if (claim.count === 0) {
            const previous =
              await transaction.productTaskImportReceipt.findUniqueOrThrow({
                where: { actorId_operation_idempotencyKey: receiptKey },
              });
            if (!fingerprint.recognizes(previous.requestFingerprint))
              throw new Rollback({ code: "idempotency_conflict" });
            // A historical receipt; the caller reads again to learn the current state.
            return taskImportReceiptSchema.parse(previous.receipt);
          }
          const lockedBinding =
            command.embeddedMaterialSourceId === undefined
              ? null
              : await dependencies.directory.lockPrimaryPlacement(
                  transaction,
                  command.productId,
                  command.embeddedMaterialSourceId,
                );
          if (
            command.embeddedMaterialSourceId !== undefined &&
            lockedBinding?.chapterId !== command.chapterId
          )
            throw new Rollback({ code: "source_mismatch" });
          await lockProductTaskImport(transaction, command.code);
          const current = await transaction.productTask.findUnique({
            where: { code: command.code },
          });
          if ((current?.revision ?? null) !== command.expectedRevision)
            throw new Rollback({ code: "task_revision_conflict" });
          if (
            current !== null &&
            (current.sourceId !== command.sourceId ||
              current.productId !== command.productId)
          )
            throw new Rollback({ code: "source_mismatch" });
          const embeddedMaterialId = lockedBinding?.materialId ?? null;
          if (embeddedMaterialId !== null) {
            await lockProductTaskImport(
              transaction,
              `material:${embeddedMaterialId}`,
            );
            const other = await transaction.productTask.findUnique({
              where: { embeddedMaterialId },
            });
            if (other !== null && other.code !== command.code)
              throw new Rollback({ code: "source_mismatch" });
          }
          const saved = await saveTask(
            transaction,
            current,
            command,
            clock(),
            embeddedMaterialId,
          );
          await transaction.productTaskImportReceipt.update({
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
  transaction: ProductTasksPrisma,
  current: TaskRow | null,
  command: SourceTask,
  now: Date,
  embeddedMaterialId: string | null,
): Promise<TaskImportReceipt> {
  const digest = taskDefinitionDigest(command.definition);
  const page =
    command.page === undefined || command.pageBody === undefined
      ? undefined
      : {
          source: command.page,
          body: command.pageBody,
          resolvedLinks: command.resolvedLinks,
          resolvedImages: command.resolvedImages,
        };
  const state = {
    ...(page === undefined ? {} : { page }),
    chapterId: command.chapterId,
    position: command.position,
    title: command.title,
    access: command.access,
    relatedMaterialSourceIds: [...command.relatedMaterialSourceIds],
    afterMaterialSourceId: command.afterMaterialSourceId,
    programmeVisibility: command.programmeVisibility ?? "standalone",
    embeddedMaterialId,
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
    await transaction.productTask.create({
      data: {
        id: taskId,
        code: command.code,
        sourceId: command.sourceId,
        productId: command.productId,
        ...state,
        currentVersion: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    await transaction.productTaskVersion.create({
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
  const currentVersion = await transaction.productTaskVersion.findUniqueOrThrow(
    {
      where: {
        taskId_version: { taskId: current.id, version: current.currentVersion },
      },
    },
  );
  const newVersion = currentVersion.definitionDigest !== digest;
  const stateChanged =
    (page !== undefined &&
      commandDigest(current.page) !== commandDigest(page)) ||
    current.programmeVisibility !== state.programmeVisibility ||
    current.embeddedMaterialId !== state.embeddedMaterialId ||
    current.chapterId !== state.chapterId ||
    current.position !== state.position ||
    current.title !== state.title ||
    current.access !== state.access ||
    current.afterMaterialSourceId !== state.afterMaterialSourceId ||
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
    await transaction.productTaskVersion.create({
      data: { taskId: current.id, version: versionNumber, ...version },
    });
  await transaction.productTask.update({
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

/** Product, chapter and related Materials are judged before the import transaction opens. */
async function checkPlacement(
  directory: TaskImportDependencies["directory"],
  command: SourceTask,
): Promise<Result<string | null, TaskImportError>> {
  try {
    const [migration] = await directory.materialsBySource([command.sourceId]);
    if (migration !== undefined)
      return { ok: false, error: { code: "source_mismatch" } };
    const [product] = await directory.products({ ids: [command.productId] });
    if (product === undefined || product.archived)
      return { ok: false, error: { code: "product_not_found" } };
    if (!product.chapters.some((chapter) => chapter.id === command.chapterId))
      return { ok: false, error: { code: "chapter_not_found" } };
    let embeddedMaterialId: string | null = null;
    if (command.embeddedMaterialSourceId !== undefined) {
      const [binding] = await directory.placements(product.id, [
        command.embeddedMaterialSourceId,
      ]);
      if (binding?.chapterId !== command.chapterId)
        return { ok: false, error: { code: "source_mismatch" } };
      embeddedMaterialId = binding.materialId;
    }
    const after = command.afterMaterialSourceId;
    if (after !== null) {
      const placements = await directory.placements(product.id, [after]);
      if (
        !placements.some(
          (placement) => placement.chapterId === command.chapterId,
        )
      )
        return {
          ok: false,
          error: { code: "after_material_not_in_chapter", sourceId: after },
        };
    }
    const known = new Set(
      (await directory.materialsBySource(command.relatedMaterialSourceIds)).map(
        (material) => material.sourceId,
      ),
    );
    const missing = command.relatedMaterialSourceIds.filter(
      (sourceId) => !known.has(sourceId),
    );
    return missing.length === 0
      ? { ok: true, value: embeddedMaterialId }
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

async function receiptOf(
  prisma: ProductTasksPrisma,
  task: TaskRow,
): Promise<TaskImportReceipt> {
  const version = await prisma.productTaskVersion.findUniqueOrThrow({
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
