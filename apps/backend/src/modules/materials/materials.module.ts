import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCOUNTS,
  AccountsModule,
  type Accounts,
} from "../accounts/index.js";
import { assembleMaterialAuthoring } from "./facets/material-authoring/assemble-material-authoring.js";
import type { MaterialAuthoring } from "./facets/material-authoring/material-authoring.js";
import { MATERIAL_AUTHORING } from "./facets/material-authoring/material-authoring.token.js";
import type { AuthorPolicy } from "./ports/author-policy.js";
import { assembleBaselineContentAccess } from "./ports/content-access.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "./facets/published-material-reader/published-material-reader.js";
import { assemblePublishedMaterialReader } from "./facets/published-material-reader/assemble-published-material-reader.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

const publicReaderPolicy: AuthorPolicy = {
  canManage: () => false,
};

@Module({
  imports: [PrismaModule, AccountsModule],
  providers: [
    {
      provide: MATERIAL_AUTHORING,
      inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
      ): MaterialAuthoring => {
        const authorPolicy: AuthorPolicy = {
          canManage: (accountId) => isPermissionAllowed(accounts, accountId),
        };
        const contentAccess = assembleBaselineContentAccess(authorPolicy);
        return assembleMaterialAuthoring({
          prisma,
          authorPolicy,
          contentAccess,
          materialBodyOperations,
        });
      },
    },
    {
      provide: PUBLISHED_MATERIAL_READER,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): PublishedMaterialReader =>
        assemblePublishedMaterialReader({
          prisma,
          // Accounts replaces this baseline when it becomes a real
          // production dependency of published reading.
          contentAccess: assembleBaselineContentAccess(publicReaderPolicy),
          materialBodyOperations,
        }),
    },
  ],
  exports: [MATERIAL_AUTHORING, PUBLISHED_MATERIAL_READER],
})
export class MaterialsModule {}

async function isPermissionAllowed(
  accounts: Accounts,
  accountId: string,
): Promise<boolean> {
  const decision = await accounts.checkPermission({
    accountId,
    permission: "materials:manage",
  });
  if (!decision.ok) {
    throw new Error(`Account permission check failed: ${decision.error.code}`);
  }
  return decision.allowed;
}
