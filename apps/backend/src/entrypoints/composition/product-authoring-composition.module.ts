import { Global, Module } from "@nestjs/common";
import {
  ACCOUNTS,
  AccountsModule,
  type Accounts,
} from "../../modules/accounts/index.js";
import {
  PrismaModule,
  PrismaClientProvider,
  transactionHandle,
} from "../../infrastructure/prisma/index.js";
import {
  PRODUCT_AUTHORING,
  PRODUCT_MATERIALS,
  assembleProductAuthoring,
  type ProductMaterials,
} from "../../modules/products/index.js";
import {
  PRODUCT_ACCESS_HOLDERS,
  type ProductAccessHolders,
} from "../../modules/materials/ports/product-access-holders.js";
import { loadContentCoverProjections } from "../../modules/content-covers/index.js";

@Global()
@Module({
  imports: [AccountsModule, PrismaModule],
  providers: [
    {
      provide: PRODUCT_AUTHORING,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        PRODUCT_MATERIALS,
        PRODUCT_ACCESS_HOLDERS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        materials: ProductMaterials,
        holders: ProductAccessHolders,
      ) =>
        assembleProductAuthoring({
          prisma,
          materials,
          productAccessHolders: holders,
          authorPolicy: {
            async canManage(accountId, handle) {
              const decision = await accounts.checkPermission(
                { accountId, permission: "materials:manage" },
                handle,
              );
              return decision.ok && decision.allowed;
            },
          },
          loadCovers: (ids, handle) =>
            loadContentCoverProjections(
              handle ?? transactionHandle(prisma),
              ids,
            ),
        }),
    },
  ],
  exports: [PRODUCT_AUTHORING],
})
export class ProductAuthoringCompositionModule {}
