import { type DynamicModule, Module } from "@nestjs/common";

import {
  PLATFORM_DATABASE,
  PostgresModule,
  type PlatformDatabase,
} from "../../infrastructure/postgres/index.js";
import { AUTHOR_POLICY, type AuthorPolicy } from "./application/ports/author-policy.js";
import { createBaselineContentAccess } from "./application/ports/content-access.js";
import {
  CONTENT_AUTHORING,
  type ContentAuthoring,
} from "./application/content-authoring.interface.js";
import { createContentAuthoringImplementation } from "./application/create-content-authoring.js";
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
          provide: CONTENT_AUTHORING,
          inject: [PLATFORM_DATABASE, AUTHOR_POLICY],
          useFactory: (
            database: PlatformDatabase,
            policy: AuthorPolicy,
          ): ContentAuthoring =>
            createContentAuthoringImplementation({
              database,
              materialDocumentOperations,
              authorPolicy: policy,
              contentAccess: createBaselineContentAccess(policy),
            }),
        },
      ],
      exports: [CONTENT_AUTHORING],
    };
  }
}
