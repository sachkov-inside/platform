import type {
  INestApplicationContext,
  NestApplicationOptions,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import type { PlatformConfig } from "../config/platform-config.js";
import { McpModule } from "./mcp.module.js";

export function createMcpApplication(
  config?: PlatformConfig,
  options: NestApplicationOptions = {},
): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(McpModule.forRoot(config), options);
}
