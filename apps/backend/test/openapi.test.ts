import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { parsePlatformConfig } from "../src/config/platform-config.js";
import {
  createApiApplication,
  createApiOpenApiDocument,
} from "../src/entrypoints/api/create-api-application.js";

describe("OpenAPI contract", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiApplication(parsePlatformConfig({ NODE_ENV: "test" }), {
      abortOnError: false,
      logger: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  test("publishes stable operation ids and concrete success schemas", () => {
    const document = createApiOpenApiDocument(app);
    const expectedOperations = [
      ["/health", "get", "getApiHealth"],
      ["/library/materials", "get", "listPublishedMaterials"],
      ["/materials/{slug}", "get", "readPublishedMaterial"],
      ["/authoring/materials", "post", "createMaterialDraft"],
      ["/authoring/materials/{materialId}/draft", "get", "loadMaterialDraft"],
      ["/authoring/materials/{materialId}/revisions", "post", "reviseMaterialDraft"],
      ["/authoring/materials/{materialId}/revisions/{revisionId}/validation", "get", "validateMaterialRevision"],
      ["/authoring/materials/{materialId}/revisions/{revisionId}/preview", "get", "previewMaterialRevision"],
      ["/authoring/materials/{materialId}/publication", "put", "publishMaterialRevision"],
      ["/authoring/materials/{materialId}/publication", "delete", "unpublishMaterial"],
      ["/authoring/materials/{materialId}/revisions/{revisionId}/restore", "post", "restoreMaterialRevision"],
      ["/accounts", "post", "establishAccount"],
      ["/accounts/current", "get", "resolveCurrentAccount"],
    ] as const;

    for (const [path, method, operationId] of expectedOperations) {
      const pathItem: unknown = document.paths[path];
      expect(isRecord(pathItem), `${method.toUpperCase()} ${path}`).toBe(true);
      if (!isRecord(pathItem)) continue;
      const operation = pathItem[method];
      expect(isRecord(operation), `${method.toUpperCase()} ${path}`).toBe(true);
      if (!isRecord(operation)) continue;
      expect(operation.operationId).toBe(operationId);
      expect(hasSuccessContent(operation), `${method.toUpperCase()} ${path} success schema`).toBe(true);
    }
  });

  test("fully describes every operation consumed by Web", () => {
    const document = createApiOpenApiDocument(app);

    const health = operation(document, "/health", "get");
    expect(health).toMatchObject({ operationId: "getApiHealth" });
    expect(hasResponseSchema(health, "200", "application/json")).toBe(true);
    expect(hasResponseSchema(health, "503", "application/problem+json")).toBe(true);
    expect(health.parameters).toEqual([]);
    expect(health.security).toBeUndefined();

    const library = operation(document, "/library/materials", "get");
    expect(library).toMatchObject({
      operationId: "listPublishedMaterials",
      parameters: [
        {
          in: "query",
          name: "after",
          required: false,
          schema: { maxLength: 512, minLength: 1, type: "string" },
        },
      ],
    });
    expect(hasResponseSchema(library, "200", "application/json")).toBe(true);
    for (const status of ["400", "500", "503"] as const) {
      expect(hasResponseSchema(library, status, "application/problem+json")).toBe(true);
    }
    expect(library.security).toBeUndefined();

    const reader = operation(document, "/materials/{slug}", "get");
    expect(reader).toMatchObject({
      operationId: "readPublishedMaterial",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { maxLength: 120, minLength: 1, type: "string" },
        },
      ],
    });
    expect(hasResponseSchema(reader, "200", "application/json")).toBe(true);
    for (const status of ["400", "404", "500", "503"] as const) {
      expect(hasResponseSchema(reader, status, "application/problem+json")).toBe(true);
    }
    expect(reader.security).toBeUndefined();

    for (const [path, method, operationId] of [
      ["/accounts", "post", "establishAccount"],
      ["/accounts/current", "get", "resolveCurrentAccount"],
    ] as const) {
      const account = operation(document, path, method);
      expect(account).toMatchObject({
        operationId,
        security: [{ logto: [] }],
      });
      expect(
        hasResponseSchema(
          account,
          method === "get" ? "200" : "201",
          "application/json",
        ),
      ).toBe(true);
      for (const status of ["400", "401", "500", "503"] as const) {
        expect(hasResponseSchema(account, status, "application/problem+json")).toBe(true);
      }
    }
  });
});

function operation(
  document: ReturnType<typeof createApiOpenApiDocument>,
  path: string,
  method: "get" | "post",
): Readonly<Record<string, unknown>> {
  const pathItem: unknown = document.paths[path];
  if (!isRecord(pathItem) || !isRecord(pathItem[method])) {
    throw new TypeError(`Missing ${method.toUpperCase()} ${path}`);
  }
  return pathItem[method];
}

function hasSuccessContent(operation: Readonly<Record<string, unknown>>): boolean {
  const responses = operation.responses;
  if (!isRecord(responses)) return false;
  const success = responses["200"] ?? responses["201"];
  return isRecord(success) && isRecord(success.content);
}

function hasResponseSchema(
  operation: Readonly<Record<string, unknown>>,
  status: string,
  mediaType: string,
): boolean {
  const responses = operation.responses;
  if (!isRecord(responses)) return false;
  const response = responses[status];
  if (!isRecord(response) || !isRecord(response.content)) return false;
  const media = response.content[mediaType];
  return isRecord(media) && isRecord(media.schema);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
