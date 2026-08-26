import type { NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from "@nestjs/swagger";

import type { PlatformConfig } from "../../config/platform-config.js";
import { ApiModule } from "./api.module.js";

export async function createApiApplication(
  config: PlatformConfig,
  options: NestApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule.forRoot(config),
    new FastifyAdapter(),
    options,
  );
  SwaggerModule.setup("openapi", app, () => createApiOpenApiDocument(app));
  app.enableShutdownHooks();

  return app;
}

export function createApiOpenApiDocument(
  app: NestFastifyApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Inside Platform API")
    .setDescription(
      "Canonical REST contract for the Inside Platform web and agent adapters.",
    )
    .setVersion("1.0.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Logto access token for the exact Platform API audience.",
      },
      "logto",
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    autoTagControllers: false,
  });
}
