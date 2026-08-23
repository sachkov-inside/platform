import { type DynamicModule, Module } from "@nestjs/common";

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
  CONTENT_AUTHORING,
  type ContentAuthoring,
} from "./application/content-authoring.interface.js";
import { createContentAuthoringImplementation } from "./application/create-content-authoring.js";
import { createPublishedMaterialsImplementation } from "./application/create-published-materials.js";
import {
  PUBLISHED_MATERIALS,
  type PublishedMaterials,
} from "./application/published-materials.interface.js";
import { materialDocumentOperations } from "./infrastructure/tiptap/index.js";

@Module({})
export class MaterialsModule {
  static register(authorPolicy: AuthorPolicy): DynamicModule {
    return {
      module: MaterialsModule,
      imports: [PostgresModule],
      providers: [
        { provide: AUTHOR_POLICY, useValue: authorPolicy },
        {
          provide: CONTENT_ACCESS,
          inject: [AUTHOR_POLICY],
          useFactory: (policy: AuthorPolicy): ContentAccess =>
            createBaselineContentAccess(policy),
        },
        {
          provide: CONTENT_AUTHORING,
          inject: [PLATFORM_DATABASE, AUTHOR_POLICY, CONTENT_ACCESS],
          useFactory: (
            database: PlatformDatabase,
            policy: AuthorPolicy,
            contentAccess: ContentAccess,
          ): ContentAuthoring =>
            createContentAuthoringImplementation({
              database,
              materialDocumentOperations,
              authorPolicy: policy,
              contentAccess,
            }),
        },
        {
          provide: PUBLISHED_MATERIALS,
          inject: [PLATFORM_DATABASE, CONTENT_ACCESS],
          useFactory: (
            database: PlatformDatabase,
            contentAccess: ContentAccess,
          ): PublishedMaterials =>
            createPublishedMaterialsImplementation({
              database,
              contentAccess,
              materialDocumentOperations,
            }),
        },
      ],
      exports: [CONTENT_AUTHORING, PUBLISHED_MATERIALS],
    };
  }
}
