import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { AuthorPolicy } from "../../../../infrastructure/content-authoring/author-policy.js";
import type {
  HolderCountPolicy,
  ProductAccessHolders,
} from "../../ports/product-access-holders.js";
import type { ProductMaterials } from "../../ports/product-materials.js";
export interface ProductAuthoringDependencies {
  readonly prisma: ProductsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
  readonly materials: ProductMaterials;
  readonly productAccessHolders?: ProductAccessHolders;
  /** Absent: no actor sees holder counts in the authoring list. */
  readonly holderCountPolicy?: HolderCountPolicy;
  readonly loadCovers: (
    ids: readonly string[],
    handle?: TransactionHandle,
  ) => Promise<
    ReadonlyMap<
      string,
      {
        readonly coverId: string;
        readonly renditions: readonly {
          readonly width: number;
          readonly height: number;
        }[];
      }
    >
  >;
}
