import type {
  INestApplicationContext,
  NestApplicationOptions,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import type { PlatformConfig } from "../config/platform-config.js";
import { RuntimeModule } from "./runtime.module.js";

export function createRuntimeApplication(
  config: PlatformConfig,
  options: NestApplicationOptions = {},
): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(RuntimeModule.forRoot(config), options);
}
