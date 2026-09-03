import { type DynamicModule, Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { repositoryEnvPath } from "./load-repository-environment.js";
import {
  PLATFORM_CONFIG,
  parsePlatformProcessConfig,
  type BackendProcess,
  type PlatformConfig,
} from "./platform-config.js";

@Global()
@Module({})
export class PlatformConfigModule {
  static forRoot(
    config?: PlatformConfig,
    process: BackendProcess = "api",
  ): DynamicModule {
    if (config === undefined) {
      return {
        module: PlatformConfigModule,
        imports: [
          ConfigModule.forRoot({
            cache: true,
            envFilePath: repositoryEnvPath,
          }),
        ],
        providers: [
          {
            provide: PLATFORM_CONFIG,
            useFactory: () => parsePlatformProcessConfig(globalThis.process.env, process),
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
