import { Module } from "@nestjs/common";

import {
  PLATFORM_DATABASE,
  PostgresModule,
  type PlatformDatabase,
} from "../../infrastructure/postgres/index.js";
import { CONTENT_LIBRARY, type ContentLibrary } from "./content-library.interface.js";
import { createContentLibrary } from "./create-content-library.js";

@Module({
  imports: [PostgresModule],
  providers: [
    {
      provide: CONTENT_LIBRARY,
      inject: [PLATFORM_DATABASE],
      useFactory: (database: PlatformDatabase): ContentLibrary =>
        createContentLibrary({ database }),
    },
  ],
  exports: [CONTENT_LIBRARY],
})
export class ContentLibraryModule {}

