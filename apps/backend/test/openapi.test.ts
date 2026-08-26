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
});

function hasSuccessContent(operation: Readonly<Record<string, unknown>>): boolean {
  const responses = operation.responses;
  if (!isRecord(responses)) return false;
  const success = responses["200"] ?? responses["201"];
  return isRecord(success) && isRecord(success.content);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
