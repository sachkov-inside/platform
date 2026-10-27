import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { AuthorPolicy } from "../../../../infrastructure/content-authoring/author-policy.js";
import type { ProductAccessHolders } from "../../ports/product-access-holders.js";
import type { ProductMaterials } from "../../ports/product-materials.js";
export interface ProductAuthoringDependencies {
  readonly prisma: ProductsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
  readonly materials: ProductMaterials;
  readonly productAccessHolders?: ProductAccessHolders;
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
