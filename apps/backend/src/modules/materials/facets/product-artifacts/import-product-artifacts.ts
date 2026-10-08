import { randomUUID } from "node:crypto";
import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import {
  checkContentWrite,
  type ContentWriteTarget,
  type ContentWriter,
} from "../../domain/content-write-policy.js";
import { lockSeries } from "../../infrastructure/postgres/series-order.js";
import { executeAuthoringTransaction } from "../../shared/application-result.js";
import {
  IMPORT_ARTIFACT_LIMIT,
  importSchema,
  type AuthoringImportCommand,
  type ImportedArtifactSource,
} from "./product-artifact-commands.js";
import type { StoredArtifactFile } from "./product-artifact-files.js";
import {
  failure,
  loadArtifactsBySource,
  loadPlacedArtifacts,
  readyVersion,
  reopenVersionOnAccessChange,
  supersedeVersion,
  versionRow,
  type ArtifactRow,
  type ProductArtifactContext,
} from "./product-artifact-records.js";
import type {
  ApplyAuthoringImportCommand,
  AuthoringImportOutcome,
  AuthoringImportReport,
  ProductArtifactError,
  ProductArtifactResult,
} from "./product-artifacts.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";

interface PreparedArtifact {
  readonly artifactId: string;
  readonly source: ImportedArtifactSource;
  readonly stored: StoredArtifactFile | null;
}

/** Stage bytes before the transaction; ownership, placements and content commit together. */
export async function applyAuthoringImport(
  context: ProductArtifactContext,
  input: ApplyAuthoringImportCommand,
): Promise<ProductArtifactResult<AuthoringImportReport>> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const command = parsed.data;
  const forbidden = await context.authorize(command.actor);
  if (forbidden !== null) return failure(forbidden);
  const sourceIds = command.artifacts.map(({ sourceId }) => sourceId);
  if (new Set(sourceIds).size !== sourceIds.length)
    return failure({ code: "source_conflict" });
  const prepared: PreparedArtifact[] = [];
  let committed = false;
  const consumedFiles = new Set<string>();
  try {
    const candidates = await loadArtifactsBySource(context.prisma, sourceIds);
    for (const source of command.artifacts) {
      const existing = candidates.find(
        (row) => row.sourceId === source.sourceId,
      );
      const artifactId = existing?.id ?? randomUUID();
      let stored: StoredArtifactFile | null = null;
      if (
        source.file !== undefined &&
        (existing === undefined ||
          (existing.revision === existing.importedRevision &&
            !sameContent(existing, source)))
      ) {
        const file = await context.files.store(artifactId, source.file);
        if (!file.ok) return file;
        stored = file.value;
      }
      prepared.push({ artifactId, source, stored });
    }
    const result = await executeAuthoringTransaction<
      AuthoringImportReport,
      ProductArtifactError
    >(
      context.prisma,
      async (transaction, rollback) => {
        // All artifact writers take Artifact locks before Product locks.
        if (sourceIds.length > 0)
          await transaction.$executeRaw(
            Prisma.sql`select id from materials.product_artifacts where source_id = any(${sourceIds}::text[]) order by id for update`,
          );
        const current = await loadArtifactsBySource(transaction, sourceIds);
        const placedProductIds =
          command.productSourceId === undefined
            ? current.flatMap((row) =>
                row.placements.map(({ productId }) => productId),
              )
            : [];
        const productIds = [
          ...new Set([command.productId, ...placedProductIds]),
        ];
        await lockSeries(transaction, productIds);
        const products = await transaction.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sourceId: true },
        });
        if (!products.some(({ id }) => id === command.productId))
          return rollback({ code: "product_not_found" });
        const writer: ContentWriter =
          command.productSourceId === undefined
            ? { via: "legacy-artifact-import", sourceId: null }
            : { via: "import", sourceId: command.productSourceId };
        const targets: ContentWriteTarget[] = [
          ...products.map((product) => ({
            kind: "product" as const,
            sourceId: product.sourceId,
            path: "/productId",
          })),
          ...current.map((artifact) => ({
            kind: "artifact" as const,
            sourceId: artifact.sourceId,
            requestedSourceId: command.artifacts.find(
              (source) => source.sourceId === artifact.sourceId,
            )?.sourceId,
            path: "/artifacts",
          })),
        ];
        const sourceError = checkContentWrite(writer, targets);
        if (sourceError !== null) return rollback({ code: "forbidden" });
        const authored = (
          await loadPlacedArtifacts(transaction, command.productId, {
            take: IMPORT_ARTIFACT_LIMIT,
          })
        ).filter(({ origin }) => origin === "authoring");
        const outcomes: AuthoringImportOutcome[] = [];
        for (const item of prepared) {
          const existing = current.find(
            (row) => row.sourceId === item.source.sourceId,
          );
          if (
            existing !== undefined &&
            existing.revision !== existing.importedRevision
          ) {
            outcomes.push(
              outcome(existing.id, item.source, "diverged", existing.title),
            );
            continue;
          }
          if (existing !== undefined && existing.id !== item.artifactId)
            return rollback({ code: "source_conflict" });
          if (existing === undefined) {
            await createFromSource(transaction, command, item);
            consumedFiles.add(item.source.sourceId);
            outcomes.push(outcome(item.artifactId, item.source, "created"));
            continue;
          }
          const unchangedContent = sameContent(existing, item.source);
          if (
            !unchangedContent &&
            item.source.file !== undefined &&
            item.stored === null
          )
            return rollback({ code: "source_conflict" });
          await transaction.productArtifactPlacement.createMany({
            data: [{ artifactId: existing.id, productId: command.productId }],
            skipDuplicates: true,
          });
          if (
            unchangedContent &&
            existing.title === item.source.title &&
            existing.purpose === item.source.purpose &&
            existing.access === item.source.access
          ) {
            outcomes.push(outcome(existing.id, item.source, "unchanged"));
          } else {
            await updateFromSource(
              transaction,
              command,
              existing,
              item,
              unchangedContent,
            );
            if (!unchangedContent) consumedFiles.add(item.source.sourceId);
            outcomes.push(outcome(existing.id, item.source, "updated"));
          }
        }
        outcomes.push(
          ...authored
            .filter((row) => !sourceIds.includes(row.sourceId ?? ""))
            .map((row) => ({
              artifactId: row.id,
              outcome: "missing" as const,
              sourceId: row.sourceId,
              title: row.title,
            })),
        );
        return { outcomes };
      },
      () => ({ code: "dependency_unavailable", retryable: true }),
      "applyAuthoringImport",
    );
    committed = result.ok;
    if (result.ok) {
      for (const item of prepared) {
        if (consumedFiles.has(item.source.sourceId))
          await context.files.forgetQuarantine(item.stored);
        else await context.files.discard(item.stored);
      }
    }
    return result;
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "applyAuthoringImport" },
      error,
      { ok: false, error: { code: "dependency_unavailable", retryable: true } },
    );
  } finally {
    if (!committed)
      for (const item of prepared) await context.files.discard(item.stored);
  }
}

function sameContent(
  existing: ArtifactRow,
  source: ImportedArtifactSource,
): boolean {
  const current = readyVersion(existing);
  return (
    current !== null &&
    (source.file === undefined
      ? current.contentKind === "link" &&
        current.externalUrl === source.externalUrl
      : current.contentKind === "file" &&
        current.checksumSha256 === source.file.expectedChecksumSha256)
  );
}

function outcome(
  artifactId: string,
  source: ImportedArtifactSource,
  result: AuthoringImportOutcome["outcome"],
  title = source.title,
): AuthoringImportOutcome {
  return { artifactId, sourceId: source.sourceId, outcome: result, title };
}

async function createFromSource(
  transaction: MaterialsPrismaTransaction,
  command: AuthoringImportCommand,
  item: PreparedArtifact,
): Promise<void> {
  const { artifactId, source, stored } = item;
  await transaction.productArtifact.create({
    data: {
      access: source.access,
      createdBy: command.actor,
      currentVersion: 1,
      id: artifactId,
      importedAt: new Date(),
      importedRevision: 1,
      origin: "authoring",
      purpose: source.purpose,
      sourceId: source.sourceId,
      state: "active",
      title: source.title,
    },
  });
  await transaction.productArtifactVersion.create({
    data: versionRow({
      actor: command.actor,
      artifactId,
      stored,
      version: 1,
      ...(source.externalUrl === undefined
        ? {}
        : { externalUrl: source.externalUrl }),
    }),
  });
  await transaction.productArtifactPlacement.create({
    data: { artifactId, productId: command.productId },
  });
}

async function updateFromSource(
  transaction: MaterialsPrismaTransaction,
  command: AuthoringImportCommand,
  existing: ArtifactRow,
  item: PreparedArtifact,
  unchangedContent: boolean,
): Promise<void> {
  const { source, stored } = item;
  const nextVersion = unchangedContent
    ? await reopenVersionOnAccessChange(transaction, {
        actor: command.actor,
        artifactId: existing.id,
        currentAccess: existing.access,
        currentVersion: existing.currentVersion,
        nextAccess: source.access,
      })
    : existing.currentVersion + 1;
  if (!unchangedContent) {
    await transaction.productArtifactVersion.create({
      data: versionRow({
        actor: command.actor,
        artifactId: existing.id,
        stored,
        version: nextVersion,
        ...(source.externalUrl === undefined
          ? {}
          : { externalUrl: source.externalUrl }),
      }),
    });
    await supersedeVersion(transaction, existing.id, existing.currentVersion);
  }
  const revision = existing.revision + 1;
  await transaction.productArtifact.update({
    where: { id: existing.id },
    data: {
      access: source.access,
      currentVersion: nextVersion,
      importedAt: new Date(),
      importedRevision: revision,
      purpose: source.purpose,
      revision,
      title: source.title,
      updatedAt: new Date(),
    },
  });
}
