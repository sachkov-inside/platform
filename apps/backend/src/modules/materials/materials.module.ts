import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCOUNTS,
  accountId as checkedAccountId,
  AccountsModule,
  type Accounts,
} from "../accounts/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  assembleDeterministicMembershipEntitlements,
  CONTENT_ACCESS,
  type ContentAccess,
} from "../content-access/index.js";
import { assembleMaterialResourceFacts } from "./adapters/content-access/material-resource-facts.js";
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
import {
  assembleMaterialContent,
  MATERIAL_CONTENT,
  type MaterialContent,
} from "./facets/material-content/material-content.js";

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
        const accountPermissions = assembleCurrentAccountPermissions(accounts);
        const authorPolicy: AuthorPolicy = {
          canManage: (accountId) =>
            accountPermissions.hasMaterialsManage(checkedAccountId(accountId)),
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
      provide: MATERIAL_CONTENT,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): MaterialContent =>
        assembleMaterialContent({ prisma, materialBodyOperations }),
    },
    {
      provide: CONTENT_ACCESS,
      inject: [MATERIAL_CONTENT, ACCOUNTS],
      useFactory: (
        materialContent: MaterialContent,
        accounts: Accounts,
      ): ContentAccess =>
        assembleContentAccess({
          materialResourceFacts: assembleMaterialResourceFacts(materialContent),
          accountPermissions: assembleCurrentAccountPermissions(accounts),
          membershipEntitlements:
            assembleDeterministicMembershipEntitlements(),
        }),
    },
    {
      provide: PUBLISHED_MATERIAL_READER,
      inject: [
        PrismaClientProvider,
        CONTENT_ACCESS,
        MATERIAL_CONTENT,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        config: PlatformConfig,
      ): PublishedMaterialReader =>
        assemblePublishedMaterialReader({
          prisma,
          contentAccess,
          materialContent,
          materialBodyOperations,
          membershipAcquisitionUrl:
            config.contentAccess.membershipAcquisitionUrl,
        }),
    },
  ],
  exports: [
    CONTENT_ACCESS,
    MATERIAL_AUTHORING,
    PUBLISHED_MATERIAL_READER,
  ],
})
export class MaterialsModule {}
