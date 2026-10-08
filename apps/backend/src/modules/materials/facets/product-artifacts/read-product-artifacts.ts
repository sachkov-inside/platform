import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  AUTHORING_ARTIFACT_LIMIT,
  listSchema,
  reusableListSchema,
  uuidSchema,
} from "./product-artifact-commands.js";
import {
  currentContent,
  dependencyUnavailable,
  failure,
  loadArtifactRow,
  loadPlacedArtifacts,
  projectRow,
  readAccess,
  readyVersion,
  type ProductArtifactContext,
} from "./product-artifact-records.js";
import type {
  ProductArtifactAccessFacts,
  ProductArtifactDto,
  ProductArtifactFileDelivery,
  ProductArtifactResult,
  ReaderProductArtifact,
} from "./product-artifacts.js";

// Reads of Product Artifacts: author lists, the reader's Product view, file delivery and access facts.

export async function listProductArtifacts(
  context: ProductArtifactContext,
  query: { readonly actor: string; readonly productId: string },
): Promise<ProductArtifactResult<readonly ProductArtifactDto[]>> {
  const { prisma } = context;
  const parsed = listSchema.safeParse(query);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const product = await prisma.product.findUnique({
      select: { id: true },
      where: { id: parsed.data.productId },
    });
    if (product === null) return failure({ code: "product_not_found" });
    const rows = await loadPlacedArtifacts(prisma, parsed.data.productId, {
      take: AUTHORING_ARTIFACT_LIMIT,
    });
    return {
      ok: true,
      value: rows.flatMap((row) => {
        const projected = projectRow(row);
        return projected === null ? [] : [projected];
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "listForProduct" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function listReusableProductArtifacts(
  context: ProductArtifactContext,
  query: { readonly actor: string },
): Promise<ProductArtifactResult<readonly ProductArtifactDto[]>> {
  const { prisma } = context;
  const parsed = reusableListSchema.safeParse(query);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const rows = await prisma.productArtifact.findMany({
      include: {
        materialLinks: { orderBy: { materialId: "asc" } },
        placements: { orderBy: { createdAt: "asc" } },
        versions: true,
      },
      orderBy: { updatedAt: "desc" },
      take: AUTHORING_ARTIFACT_LIMIT,
      where: { state: "active" },
    });
    return {
      ok: true,
      value: rows.flatMap((row) => {
        const projected = projectRow(row);
        return projected === null ? [] : [projected];
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "listReusable" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadReaderProductArtifacts(
  context: ProductArtifactContext,
  productId: string,
): Promise<ProductArtifactResult<readonly ReaderProductArtifact[]>> {
  const { prisma } = context;
  const parsedProductId = uuidSchema.safeParse(productId);
  if (!parsedProductId.success) return failure({ code: "product_not_found" });
  try {
    const product = await prisma.product.findUnique({
      select: { id: true },
      where: { id: parsedProductId.data },
    });
    if (product === null) return failure({ code: "product_not_found" });
    const rows = await loadPlacedArtifacts(prisma, parsedProductId.data, {
      state: "active",
      take: AUTHORING_ARTIFACT_LIMIT,
    });
    return {
      ok: true,
      value: rows.flatMap((row): readonly ReaderProductArtifact[] => {
        const content = currentContent(row);
        return content === null
          ? []
          : [
              {
                artifactId: row.id,
                content,
                purpose: row.purpose,
                title: row.title,
                updatedAt: row.updatedAt.toISOString(),
                version: row.currentVersion,
              },
            ];
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "loadForReader" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadProductArtifactFileDelivery(
  context: ProductArtifactContext,
  input: { readonly artifactId: string; readonly productId: string },
): Promise<ProductArtifactResult<ProductArtifactFileDelivery | null>> {
  const { prisma } = context;
  const parsedArtifactId = uuidSchema.safeParse(input.artifactId);
  const parsedProductId = uuidSchema.safeParse(input.productId);
  if (!parsedArtifactId.success || !parsedProductId.success) {
    return { ok: true, value: null };
  }
  try {
    const placement = await prisma.productArtifactPlacement.findUnique({
      where: {
        artifactId_productId: {
          artifactId: parsedArtifactId.data,
          productId: parsedProductId.data,
        },
      },
    });
    if (placement === null) return { ok: true, value: null };
    const row = await loadArtifactRow(prisma, parsedArtifactId.data);
    const current = row === null ? null : readyVersion(row);
    if (
      current?.contentKind !== "file" ||
      current.protectedObjectKey === null ||
      current.contentType === null ||
      current.byteSize === null ||
      current.originalFilename === null
    ) {
      return { ok: true, value: null };
    }
    return {
      ok: true,
      value: {
        artifactId: parsedArtifactId.data,
        contentType: current.contentType,
        filename: current.originalFilename,
        object: {
          protectedKey: current.protectedObjectKey,
          publicKey: current.publicObjectKey,
        },
        size: current.byteSize,
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "loadFileDelivery" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadProductArtifactAccessFacts(
  context: ProductArtifactContext,
  artifactIds: readonly string[],
): Promise<readonly ProductArtifactAccessFacts[]> {
  const { prisma } = context;
  const ids = artifactIds.filter(
    (value) => uuidSchema.safeParse(value).success,
  );
  if (ids.length === 0) return [];
  const rows = await prisma.productArtifact.findMany({
    include: { placements: { select: { productId: true } } },
    where: { id: { in: ids } },
  });
  return rows.map((row): ProductArtifactAccessFacts => ({
    access: readAccess(row.access),
    archived: row.state === "archived",
    artifactId: row.id,
    productIds: row.placements.map(({ productId }) => productId),
    version: row.currentVersion,
  }));
}
