import { Module } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, test } from "vitest";

import {
  LIST_PUBLISHED_MATERIALS,
  type ListPublishedMaterials,
} from "../../src/modules/content-library/index.js";
import { ListPublishedMaterialsController } from "../../src/modules/content-library/list-published-materials/list-published-materials.controller.js";

const listPublishedMaterials: ListPublishedMaterials = () =>
  Promise.resolve({
    ok: false,
    error: {
      code: "internal_error",
      correlationId: "72000000-0000-4000-8000-000000000090",
    },
  });

@Module({
  controllers: [ListPublishedMaterialsController],
  providers: [
    { provide: LIST_PUBLISHED_MATERIALS, useValue: listPublishedMaterials },
  ],
})
class ListPublishedMaterialsHttpTestModule {
  readonly adapter = "content-library-http";
}

describe("ListPublishedMaterials REST result mapping", () => {
  let application: NestFastifyApplication | undefined;

  afterEach(async () => {
    await application?.close();
  });

  test("maps an internal result at the real HTTP adapter seam", async () => {
    application = await NestFactory.create<NestFastifyApplication>(
      ListPublishedMaterialsHttpTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const response = await application.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/library/materials",
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toEqual({
      type: "urn:inside:problem:internal-error",
      title: "Internal error",
      status: 500,
      code: "internal_error",
      correlationId: "72000000-0000-4000-8000-000000000090",
    });
  });
});
