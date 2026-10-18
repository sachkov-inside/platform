import { lockMaterialReferenceChanges } from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  checkContentWrite,
  contentWriter,
} from "../../domain/content-write-policy.js";
import { lockSeries } from "../../infrastructure/postgres/series-order.js";
import { importedMaterialsSchema } from "./product-artifact-commands.js";
import {
  dependencyUnavailable,
  failure,
  projectOrFail,
  type ProductArtifactContext,
} from "./product-artifact-records.js";
import type {
  AttachImportedProductArtifactMaterialsCommand,
  ProductArtifactDto,
  ProductArtifactError,
  ProductArtifactResult,
} from "./product-artifacts.js";

/** Import may add declared links, but cannot delete another Product's unscoped bindings. */
export async function attachImportedProductArtifactMaterials(
  context: ProductArtifactContext,
  command: AttachImportedProductArtifactMaterialsCommand,
): Promise<ProductArtifactResult<ProductArtifactDto>> {
  const parsed = importedMaterialsSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const input = parsed.data;
  const forbidden = await context.authorize(input.actor);
  if (forbidden !== null) return failure(forbidden);
  const materialIds = [...new Set(input.materialIds)];
  try {
    const error = await context.prisma.$transaction(
      async (transaction): Promise<ProductArtifactError | null> => {
        // Match artifact imports: Artifact first, then Product, then Material references.
        await transaction.$executeRaw`select id from materials.product_artifacts where id = ${input.artifactId}::uuid for update`;
        const artifact = await transaction.productArtifact.findUnique({
          where: { id: input.artifactId },
          include: { placements: true },
        });
        if (artifact === null) return { code: "artifact_not_found" };
        await lockSeries(transaction, [input.productId]);
        const product = await transaction.product.findUnique({
          where: { id: input.productId },
          select: { sourceId: true },
        });
        if (product === null) return { code: "product_not_found" };
        if (
          artifact.origin !== "authoring" ||
          !artifact.placements.some(
            ({ productId }) => productId === input.productId,
          )
        )
          return { code: "forbidden" };
        if (
          artifact.revision !== artifact.importedRevision ||
          artifact.state !== "active"
        )
          return { code: "source_conflict" };
        await lockMaterialReferenceChanges(transaction, materialIds);
        const materials = await transaction.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, sourceId: true },
        });
        if (materials.length !== materialIds.length)
          return { code: "material_not_found" };
        const sourceError = checkContentWrite(
          contentWriter(input.productSourceId),
          [
            { kind: "product", sourceId: product.sourceId, path: "/productId" },
            {
              kind: "artifact",
              sourceId: artifact.sourceId,
              requestedSourceId: input.sourceId,
              path: "/artifactId",
            },
            ...materials.map((material) => ({
              kind: "membership" as const,
              sourceId: material.sourceId,
              path: "/materialIds",
            })),
          ],
        );
        if (sourceError !== null) return { code: "forbidden" };
        const memberships = await transaction.productMembership.count({
          where: { seriesId: input.productId, materialId: { in: materialIds } },
        });
        if (memberships !== materialIds.length) return { code: "forbidden" };
        const attached =
          await transaction.productArtifactMaterialLink.createMany({
            data: materialIds.map((materialId) => ({
              artifactId: input.artifactId,
              materialId,
            })),
            skipDuplicates: true,
          });
        if (attached.count > 0)
          await transaction.productArtifact.update({
            where: { id: input.artifactId },
            data: { updatedAt: new Date() },
          });
        return null;
      },
    );
    if (error !== null) return failure(error);
    return await projectOrFail(context.prisma, input.artifactId);
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "attachImportedArtifactMaterials" },
      error,
      dependencyUnavailable(),
    );
  }
}
