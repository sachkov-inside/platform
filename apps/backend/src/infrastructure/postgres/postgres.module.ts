import {
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import { createPlatformDatabase } from "./create-platform-database.js";
import { PLATFORM_DATABASE, type PlatformDatabase } from "./platform-database.js";

@Injectable()
class PlatformDatabaseLifecycle implements OnApplicationShutdown {
  readonly database: PlatformDatabase;

  constructor(@Inject(PLATFORM_CONFIG) config: PlatformConfig) {
    this.database = createPlatformDatabase(config.database.url);
  }

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
