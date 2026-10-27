import type { TransactionHandle } from "../../../infrastructure/prisma/transaction-handle.js";

export interface ProductReadingMaterial {
  readonly id: string;
  readonly sourceId: string | null;
  readonly published: { readonly slug: string; readonly title: string } | null;
  readonly topicId: string | null;
  readonly hasModeVariants: boolean;
}
/** Material identity and actual publication facts, including on the caller's locked connection. */
export interface ProductMaterialReading {
  read(
    filter:
      | { readonly ids: readonly string[] }
      | { readonly sourceIds: readonly string[] },
    handle?: TransactionHandle,
  ): Promise<readonly ProductReadingMaterial[]>;
}
export const PRODUCT_MATERIAL_READING = Symbol("PRODUCT_MATERIAL_READING");
