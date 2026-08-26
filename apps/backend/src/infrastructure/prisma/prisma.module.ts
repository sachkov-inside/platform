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
import { PrismaClient } from "./generated/client.js";
import { createPrismaPgAdapter } from "./prisma-adapter.js";

@Injectable()
export class PrismaClientProvider
  extends PrismaClient
  implements OnApplicationShutdown
{
  constructor(@Inject(PLATFORM_CONFIG) config: PlatformConfig) {
    super({
      adapter: createPrismaPgAdapter(config.database.url),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

@Module({
  providers: [PrismaClientProvider],
  exports: [PrismaClientProvider],
})
export class PrismaModule {}
