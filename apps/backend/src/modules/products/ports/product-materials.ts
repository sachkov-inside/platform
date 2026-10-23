import type { TransactionHandle } from "../../../infrastructure/prisma/transaction-handle.js";

export interface ProductMaterialFacts {
  readonly id: string;
  readonly sourceId: string | null;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly title: string | null;
  readonly access: "free" | "closed";
  readonly showInFeed: boolean;
  readonly topicId: string | null;
  readonly hasModeVariants: boolean;
}

/** Materials owns content/publication facts and its reference lock, including in Product writes. */
export interface ProductMaterials {
  load(
    ids: readonly string[],
    handle?: TransactionHandle,
  ): Promise<readonly ProductMaterialFacts[]>;
  lockReferences(
    ids: readonly string[],
    handle: TransactionHandle,
  ): Promise<void>;
  refreshSearch(
    ids: readonly string[],
    handle: TransactionHandle,
  ): Promise<void>;
}
export const PRODUCT_MATERIALS = Symbol("PRODUCT_MATERIALS");
