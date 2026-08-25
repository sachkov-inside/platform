import { Module } from "@nestjs/common";

import {
  PLATFORM_DATABASE,
  PostgresModule,
  type PlatformDatabase,
} from "../../infrastructure/postgres/index.js";
import { AUTHOR_POLICY, type AuthorPolicy } from "./application/ports/author-policy.js";
import {
  CONTENT_ACCESS,
  createBaselineContentAccess,
  type ContentAccess,
} from "./application/ports/content-access.js";
import {
  MATERIAL_AUTHORING,
  type MaterialAuthoring,
} from "./application/material-authoring.interface.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "./application/published-material-reader.interface.js";
import { createMaterials, type Materials } from "./create-materials.js";

const MATERIALS = Symbol("MATERIALS");
const publicReaderPolicy: AuthorPolicy = {
  canAuthor: () => false,
  canPublish: () => false,
};

@Module({
  imports: [PostgresModule],
  providers: [
    // The first production consumer is anonymous/read-only. IdentityPrincipals
    // replaces this real baseline policy when its owning module is delivered.
    { provide: AUTHOR_POLICY, useValue: publicReaderPolicy },
    {
      provide: CONTENT_ACCESS,
      inject: [AUTHOR_POLICY],
      useFactory: (policy: AuthorPolicy): ContentAccess =>
        createBaselineContentAccess(policy),
    },
    {
      provide: MATERIALS,
      inject: [PLATFORM_DATABASE, AUTHOR_POLICY, CONTENT_ACCESS],
      useFactory: (
        database: PlatformDatabase,
        policy: AuthorPolicy,
        contentAccess: ContentAccess,
      ): Materials =>
        createMaterials({
          database,
          authorPolicy: policy,
          contentAccess,
        }),
    },
    {
      provide: MATERIAL_AUTHORING,
      inject: [MATERIALS],
      useFactory: (materials: Materials): MaterialAuthoring =>
        materials.authoring,
    },
    {
      provide: PUBLISHED_MATERIAL_READER,
      inject: [MATERIALS],
      useFactory: (materials: Materials): PublishedMaterialReader =>
        materials.publishedMaterialReader,
    },
  ],
  exports: [MATERIAL_AUTHORING, PUBLISHED_MATERIAL_READER],
})
export class MaterialsModule {}
