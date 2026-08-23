import { Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";

import { readDatabaseConfig } from "../../config/database.js";
import { createPlatformDatabase } from "./create-platform-database.js";
import { PLATFORM_DATABASE, type PlatformDatabase } from "./platform-database.js";

@Injectable()
class PlatformDatabaseLifecycle implements OnApplicationShutdown {
  readonly database = createPlatformDatabase(readDatabaseConfig().url);

  async onApplicationShutdown(): Promise<void> {
    await this.database.destroy();
  }
}

@Module({
  providers: [
    PlatformDatabaseLifecycle,
    {
      provide: PLATFORM_DATABASE,
      inject: [PlatformDatabaseLifecycle],
      useFactory: (lifecycle: PlatformDatabaseLifecycle): PlatformDatabase => lifecycle.database,
    },
  ],
  exports: [PLATFORM_DATABASE],
})
export class PostgresModule {}
