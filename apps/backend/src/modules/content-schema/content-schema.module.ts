import { Module } from "@nestjs/common";

import { CONTENT_SCHEMA } from "./content-schema.interface.js";
import { ContentSchemaImplementation } from "./internal/content-schema.implementation.js";

@Module({
  providers: [
    {
      provide: CONTENT_SCHEMA,
      useFactory: () => new ContentSchemaImplementation(),
    },
  ],
  exports: [CONTENT_SCHEMA],
})
export class ContentSchemaModule {}
