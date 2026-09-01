import { type DynamicModule, Global, Module } from "@nestjs/common";
import { ConfigModule, registerAs } from "@nestjs/config";

import { repositoryEnvPath } from "./load-repository-environment.js";
import {
  PLATFORM_CONFIG,
  parsePlatformConfig,
  type PlatformConfig,
} from "./platform-config.js";

const nestPlatformConfig = registerAs("platform", () =>
  parsePlatformConfig(process.env),
);

@Global()
@Module({})
export class PlatformConfigModule {
  static forRoot(config?: PlatformConfig): DynamicModule {
    if (config === undefined) {
      return {
        module: PlatformConfigModule,
        imports: [
          ConfigModule.forRoot({
            cache: true,
            envFilePath: repositoryEnvPath,
            load: [nestPlatformConfig],
          }),
        ],
        providers: [
          {
            provide: PLATFORM_CONFIG,
            inject: [nestPlatformConfig.KEY],
            useFactory: (resolvedConfig: PlatformConfig) => resolvedConfig,
          },
        ],
        exports: [PLATFORM_CONFIG],
      };
    }

    return {
      module: PlatformConfigModule,
      providers: [{ provide: PLATFORM_CONFIG, useValue: config }],
      exports: [PLATFORM_CONFIG],
    };
  }
}
