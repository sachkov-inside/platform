import { randomUUID } from "node:crypto";
import {
  attachmentDisposition,
  signedDeliveryTtlSeconds,
} from "../../../materials/index.js";
import { z } from "zod";
import type { MaterialAssets } from "../../../assets/index.js";
import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import {
  findCurrentTask,
  type LearningTaskDependencies,
} from "../../shared/learning-task-dependencies.js";
import { scope, systemFailure } from "../../shared/result.js";

const taskAssetDeliveryTtlSeconds = 60;

export const TASK_ASSET_DELIVERY = Symbol("TASK_ASSET_DELIVERY");
export interface TaskAssetDelivery {
  deliver(input: {
    subject: Subject;
    productSlug: string;
    code: string;
    assetId: string;
  }): ReturnType<typeof deliverTaskAsset>;
}

export async function deliverTaskAsset(
  dependencies: LearningTaskDependencies & {
    assets: Pick<MaterialAssets, "loadDelivery" | "loadPresentations">;
    objectStorage: ObjectStorage;
  },
  input: {
    subject: Subject;
    productSlug: string;
    code: string;
    assetId: string;
  },
) {
  const notFound = () => ({
    ok: false as const,
    error: { code: "asset_not_found" as const },
  });
  if (!z.uuid().safeParse(input.assetId).success) return notFound();
  try {
    const task = await findCurrentTask(dependencies.prisma, input.code);
    if (task?.page === null || task === null) return notFound();
    const [product] = await dependencies.directory.products({
      ids: [task.productId],
    });
    if (
      product === undefined ||
      product.archived ||
      product.slug !== input.productSlug
    )
      return notFound();
    const access = await dependencies.contentAccess.authorize({
      subject: input.subject,
      resource: { kind: "productTask", taskId: task.id },
      action: "read",
      enforcementPoint: "product_task_read",
      correlationId: randomUUID(),
    });
    if (access.effect === "deny" && access.reason === "dependency_unavailable")
      return {
        ok: false as const,
        error: { code: "dependency_unavailable" as const },
      };
    if (access.effect !== "allow") return notFound();
    const reference = Object.values(task.page.resolvedImages).find(
      (item) => item.assetId === input.assetId,
    );
    if (reference === undefined) return notFound();
    const presentation = await dependencies.assets.loadPresentations(
      reference.materialId,
      [reference.assetId],
    );
    if (!presentation.ok)
      return {
        ok: false as const,
        error: { code: "dependency_unavailable" as const },
      };
    const assetPresentation = presentation.value[0];
    if (assetPresentation === undefined) return notFound();
    const variantWidth =
      assetPresentation.kind === "image"
        ? Math.max(...assetPresentation.variants.map((item) => item.width))
        : undefined;
    const loaded = await dependencies.assets.loadDelivery({
      ...reference,
      ...(variantWidth === undefined ? {} : { variantWidth }),
    });
    if (!loaded.ok)
      return {
        ok: false as const,
        error: { code: "dependency_unavailable" as const },
      };
    if (
      loaded.value === null ||
      loaded.value.materialId !== reference.materialId
    )
      return notFound();
    const asset = loaded.value;
    const ttlSeconds = signedDeliveryTtlSeconds(
      taskAssetDeliveryTtlSeconds,
      access.reason === "active_membership" ? access.validUntil : undefined,
    );
    if (ttlSeconds === null) return notFound();
    const location = await dependencies.objectStorage.signGet({
      key: asset.object.protectedKey,
      namespace: "protected",
      contentType: asset.contentType,
      ttlSeconds,
      ...(asset.kind === "file"
        ? { contentDisposition: attachmentDisposition(asset.filename) }
        : {}),
    });
    return {
      ok: true as const,
      value: {
        kind: "redirect" as const,
        cacheScope: "private-no-store" as const,
        location,
      },
    };
  } catch (error) {
    return dependencyFailure(
      scope("deliverTaskAsset"),
      error,
      systemFailure(error),
    );
  }
}
