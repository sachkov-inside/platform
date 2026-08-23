import { type DynamicModule, Module } from "@nestjs/common";

import {
  PLATFORM_DATABASE,
  PostgresModule,
  type PlatformDatabase,
} from "../../infrastructure/postgres/index.js";
import {
  CONTENT_SCHEMA,
  ContentSchemaModule,
  type ContentSchema,
} from "../content-schema/index.js";
import { CONTENT_AUTHORING, type ContentAuthoring } from "./content-authoring.interface.js";
import { AUTHOR_POLICY, type AuthorPolicy } from "./internal/author-policy.js";
import { createContentAuthoringImplementation } from "./internal/create-content-authoring.js";

@Module({})
export class ContentAuthoringModule {
  static register(authorPolicy: AuthorPolicy): DynamicModule {
    return {
      module: ContentAuthoringModule,
      imports: [PostgresModule, ContentSchemaModule],
      providers: [
        { provide: AUTHOR_POLICY, useValue: authorPolicy },
        {
          provide: CONTENT_AUTHORING,
          inject: [PLATFORM_DATABASE, CONTENT_SCHEMA, AUTHOR_POLICY],
          useFactory: (
            database: PlatformDatabase,
            contentSchema: ContentSchema,
            policy: AuthorPolicy,
          ): ContentAuthoring =>
            createContentAuthoringImplementation({
              database,
              contentSchema,
              authorPolicy: policy,
            }),
        },
      ],
      exports: [CONTENT_AUTHORING],
    };
  }
}
