import type { NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { ApiModule } from "./api.module";

export async function createApiApplication(
  options: NestApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter(),
    options,
  );
  const openApiConfig = new DocumentBuilder()
    .setTitle("Inside Platform API")
    .setVersion("0.0.0")
    .build();

  SwaggerModule.setup(
    "openapi",
    app,
    SwaggerModule.createDocument(app, openApiConfig),
  );
  app.enableShutdownHooks();

  return app;
}
