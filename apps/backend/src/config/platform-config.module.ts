import { type DynamicModule, Global, Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "./platform-config.js";

@Global()
@Module({})
export class PlatformConfigModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: PlatformConfigModule,
      providers: [{ provide: PLATFORM_CONFIG, useValue: config }],
      exports: [PLATFORM_CONFIG],
    };
  }
}
