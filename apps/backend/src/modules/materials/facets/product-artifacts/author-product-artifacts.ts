import { checkArtifactWrite } from "./artifact-write-ownership.js";
import { randomUUID } from "node:crypto";

import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import {
  archiveSchema,
  createSchema,
  productsSchema,
  materialsSchema,
  removeSchema,
  replaceSchema,
  updateSchema,
} from "./product-artifact-commands.js";
import type { StoredArtifactFile } from "./product-artifact-files.js";
import {
  dependencyUnavailable,
  failure,
  projectOrFail,
  reopenVersionOnAccessChange,
  supersedeVersion,
  versionRow,
  type ProductArtifactContext,
} from "./product-artifact-records.js";
import type {
  CreateProductArtifactCommand,
  ProductArtifactDto,
  ProductArtifactResult,
  RemoveProductArtifactCommand,
  ReplaceProductArtifactContentCommand,
  SetProductArtifactArchivedCommand,
  SetProductArtifactProductsCommand,
  SetProductArtifactMaterialsCommand,
  UpdateProductArtifactCommand,
} from "./product-artifacts.js";

// Author edits of one Product Artifact. Each operation parses, authorizes, stores new bytes before
// its transaction and forgets them when the transaction fails.

export async function createProductArtifact(
  context: ProductArtifactContext,
  command: CreateProductArtifactCommand,
): Promise<ProductArtifactResult<ProductArtifactDto>> {
  const { prisma } = context;
  const parsed = createSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const product = await prisma.product.findUnique({
      select: { id: true },
      where: { id: parsed.data.productId },
    });
    if (product === null) return failure({ code: "product_not_found" });
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "create" },
      error,
      dependencyUnavailable(),
    );
  }

  const artifactId = randomUUID();
  let stored: StoredArtifactFile | null = null;
  if (parsed.data.kind === "file") {
    const file = await context.files.store(artifactId, parsed.data.file);
    if (!file.ok) return file;
    stored = file.value;
  }
  try {
    const sourceError = await prisma.$transaction(async (transaction) => {
      const refusal = await checkArtifactWrite(transaction, null, [
        parsed.data.productId,
      ]);
      if (refusal !== null) return refusal;
      await transaction.productArtifact.create({
        data: {
          access: parsed.data.metadata.access,
          createdBy: parsed.data.actor,
          currentVersion: 1,
          id: artifactId,
          origin: "platform",
          purpose: parsed.data.metadata.purpose,
          state: "active",
          title: parsed.data.metadata.title,
        },
      });
      await transaction.productArtifactVersion.create({
        data: versionRow({
          actor: parsed.data.actor,
          artifactId,
          stored,
          version: 1,
          ...(parsed.data.kind === "link"
            ? { externalUrl: parsed.data.externalUrl }
            : {}),
        }),
      });
      await transaction.productArtifactPlacement.create({
        data: { artifactId, productId: parsed.data.productId },
      });
      return null;
    });
    if (sourceError !== null) {
      await context.files.discard(stored);
      return failure(sourceError);
    }
  } catch (error) {
    reportDependencyFailure(
      { module: "materials", operation: "create" },
      error,
    );
    await context.files.discard(stored);
    return dependencyUnavailable();
  }
  await context.files.forgetQuarantine(stored);
  return projectOrFail(prisma, artifactId);
}

export async function updateProductArtifact(
  context: ProductArtifactContext,
  command: UpdateProductArtifactCommand,
): Promise<ProductArtifactResult<ProductArtifactDto>> {
  const { prisma } = context;
  const parsed = updateSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const current = await prisma.productArtifact.findUnique({
      where: { id: parsed.data.artifactId },
    });
    if (current === null) return failure({ code: "artifact_not_found" });
    const sourceError = await prisma.$transaction(async (transaction) => {
      const refusal = await checkArtifactWrite(
        transaction,
        parsed.data.artifactId,
      );
      if (refusal !== null) return refusal;
      const nextVersion = await reopenVersionOnAccessChange(transaction, {
        actor: parsed.data.actor,
        artifactId: current.id,
        currentAccess: current.access,
        currentVersion: current.currentVersion,
        nextAccess: parsed.data.metadata.access,
      });
      await transaction.productArtifact.update({
        data: {
          access: parsed.data.metadata.access,
          currentVersion: nextVersion,
          purpose: parsed.data.metadata.purpose,
          // Revision records the accepted Platform metadata change.
          revision: { increment: 1 },
          title: parsed.data.metadata.title,
          updatedAt: new Date(),
        },
        where: { id: current.id },
      });
      return null;
    });
    if (sourceError !== null) {
      return failure(sourceError);
    }
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "update" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function replaceProductArtifactContent(
  context: ProductArtifactContext,
  command: ReplaceProductArtifactContentCommand,
): Promise<ProductArtifactResult<ProductArtifactDto>> {
  const { prisma } = context;
  const parsed = replaceSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  let currentVersion: number;
  try {
    const current = await prisma.productArtifact.findUnique({
      select: { currentVersion: true },
      where: { id: parsed.data.artifactId },
    });
    if (current === null) return failure({ code: "artifact_not_found" });
    currentVersion = current.currentVersion;
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "replaceContent" },
      error,
      dependencyUnavailable(),
    );
  }

  let stored: StoredArtifactFile | null = null;
  if (parsed.data.kind === "file") {
    const file = await context.files.store(
      parsed.data.artifactId,
      parsed.data.file,
    );
    if (!file.ok) return file;
    stored = file.value;
  }
  const nextVersion = currentVersion + 1;
  try {
    const sourceError = await prisma.$transaction(async (transaction) => {
      const refusal = await checkArtifactWrite(
        transaction,
        parsed.data.artifactId,
      );
      if (refusal !== null) return refusal;
      await transaction.productArtifactVersion.create({
        data: versionRow({
          actor: parsed.data.actor,
          artifactId: parsed.data.artifactId,
          stored,
          version: nextVersion,
          ...(parsed.data.kind === "link"
            ? { externalUrl: parsed.data.externalUrl }
            : {}),
        }),
      });
      await supersedeVersion(
        transaction,
        parsed.data.artifactId,
        currentVersion,
      );
      await transaction.productArtifact.update({
        data: {
          currentVersion: nextVersion,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
        where: { id: parsed.data.artifactId },
      });
      return null;
    });
    if (sourceError !== null) {
      await context.files.discard(stored);
      return failure(sourceError);
    }
  } catch (error) {
    reportDependencyFailure(
      { module: "materials", operation: "replaceContent" },
      error,
    );
    await context.files.discard(stored);
    return dependencyUnavailable();
  }
  await context.files.forgetQuarantine(stored);
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function setProductArtifactArchived(
  context: ProductArtifactContext,
  command: SetProductArtifactArchivedCommand,
): Promise<ProductArtifactResult<ProductArtifactDto>> {
  const { prisma } = context;
  const parsed = archiveSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const sourceError = await prisma.$transaction(async (transaction) => {
      const refusal = await checkArtifactWrite(
        transaction,
        parsed.data.artifactId,
      );
      if (refusal !== null) return refusal;
      const changed = await transaction.productArtifact.updateMany({
        data: {
          archivedAt: parsed.data.archived ? new Date() : null,
          revision: { increment: 1 },
          state: parsed.data.archived ? "archived" : "active",
          updatedAt: new Date(),
        },
        where: { id: parsed.data.artifactId },
      });
      return changed.count === 0
        ? { code: "artifact_not_found" as const }
        : null;
    });
    if (sourceError !== null) return failure(sourceError);
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "setArchived" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function setProductArtifactProducts(
  context: ProductArtifactContext,
  command: SetProductArtifactProductsCommand,
): Promise<ProductArtifactResult<ProductArtifactDto>> {
  const { prisma } = context;
  const parsed = productsSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  const productIds = [...new Set(parsed.data.productIds)];
  try {
    const artifact = await prisma.productArtifact.findUnique({
      select: { id: true },
      where: { id: parsed.data.artifactId },
    });
    if (artifact === null) return failure({ code: "artifact_not_found" });
    const known = await prisma.product.findMany({
      select: { id: true },
      where: { id: { in: productIds } },
    });
    if (known.length !== productIds.length) {
      return failure({ code: "product_not_found" });
    }
    const sourceError = await prisma.$transaction(async (transaction) => {
      const refusal = await checkArtifactWrite(
        transaction,
        parsed.data.artifactId,
        productIds,
      );
      if (refusal !== null) return refusal;
      await transaction.productArtifactPlacement.deleteMany({
        where:
          productIds.length === 0
            ? { artifactId: parsed.data.artifactId }
            : {
                artifactId: parsed.data.artifactId,
                productId: { notIn: productIds },
              },
      });
      await transaction.productArtifactPlacement.createMany({
        data: productIds.map((productId) => ({
          artifactId: parsed.data.artifactId,
          productId,
        })),
        skipDuplicates: true,
      });
      await transaction.productArtifact.update({
        data: { updatedAt: new Date() },
        where: { id: parsed.data.artifactId },
      });
      return null;
    });
    if (sourceError !== null) {
      return failure(sourceError);
    }
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "setProducts" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function setProductArtifactMaterials(
  context: ProductArtifactContext,
  command: SetProductArtifactMaterialsCommand,
): Promise<ProductArtifactResult<ProductArtifactDto>> {
  const { prisma } = context;
  const parsed = materialsSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  const materialIds = [...new Set(parsed.data.materialIds)];
  try {
    const artifact = await prisma.productArtifact.findUnique({
      select: { id: true },
      where: { id: parsed.data.artifactId },
    });
    if (artifact === null) return failure({ code: "artifact_not_found" });
    const known = await prisma.material.findMany({
      select: { id: true },
      where: { id: { in: materialIds } },
    });
    if (known.length !== materialIds.length) {
      return failure({ code: "material_not_found" });
    }
    const sourceError = await prisma.$transaction(async (transaction) => {
      const refusal = await checkArtifactWrite(
        transaction,
        parsed.data.artifactId,
      );
      if (refusal !== null) return refusal;
      await transaction.productArtifactMaterialLink.deleteMany({
        where:
          materialIds.length === 0
            ? { artifactId: parsed.data.artifactId }
            : {
                artifactId: parsed.data.artifactId,
                materialId: { notIn: materialIds },
              },
      });
      await transaction.productArtifactMaterialLink.createMany({
        data: materialIds.map((materialId) => ({
          artifactId: parsed.data.artifactId,
          materialId,
        })),
        skipDuplicates: true,
      });
      await transaction.productArtifact.update({
        data: { updatedAt: new Date() },
        where: { id: parsed.data.artifactId },
      });
      return null;
    });
    if (sourceError !== null) {
      return failure(sourceError);
    }
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "setMaterials" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function removeProductArtifact(
  context: ProductArtifactContext,
  command: RemoveProductArtifactCommand,
): Promise<ProductArtifactResult<Readonly<{ artifactId: string }>>> {
  const { prisma } = context;
  const parsed = removeSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const sourceError = await prisma.$transaction(async (transaction) => {
      const refusal = await checkArtifactWrite(
        transaction,
        parsed.data.artifactId,
      );
      if (refusal !== null) return refusal;
      const artifact = await transaction.productArtifact.findUnique({
        include: { materialLinks: true, placements: true },
        where: { id: parsed.data.artifactId },
      });
      if (artifact === null) return { code: "artifact_not_found" as const };
      if (artifact.placements.length > 0 || artifact.materialLinks.length > 0) {
        return {
          code: "artifact_referenced" as const,
          productIds: artifact.placements.map(({ productId }) => productId),
        };
      }
      await transaction.productArtifact.delete({
        where: { id: parsed.data.artifactId },
      });
      return null;
    });
    if (sourceError !== null) return failure(sourceError);
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "remove" },
      error,
      dependencyUnavailable(),
    );
  }
  return { ok: true, value: { artifactId: parsed.data.artifactId } };
}
