import process from "node:process";

import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { z } from "zod";

import { COMMUNICATIONS_PERMISSION_DENIED } from "../src/modules/communications/communications-contract.js";

const serverUrl = requireEnvironment("MCP_SMOKE_SERVER_URL");
const accessToken = requireEnvironment("MCP_SMOKE_ACCESS_TOKEN");
// Отдельный автор Materials: у него есть ровно `materials:manage`, поэтому отказ в коммуникациях
// зависит от полномочий, а не от того, что накопила локальная база на владельце стенда.
const materialsOnlyAccessToken = requireEnvironment(
  "MCP_SMOKE_MATERIALS_ONLY_ACCESS_TOKEN",
);
const topicId = "72000000-0000-4000-8000-000000000002";
const formatId = "guide";
const body = {
  schemaVersion: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: {
          level: 2,
          nodeId: "73000000-0000-4000-8000-000000000001",
        },
        content: [{ type: "text", text: "MCP authoring smoke" }],
      },
      {
        type: "paragraph",
        attrs: { nodeId: "73000000-0000-4000-8000-000000000002" },
        content: [
          {
            type: "text",
            text: "Delegated Save and Preview reached the production application interfaces.",
          },
        ],
      },
    ],
  },
};
const client = new Client({
  name: "inside-platform-full-stack-smoke",
  version: "1.0.0",
});
const materialsOnlyClient = new Client({
  name: "inside-platform-full-stack-smoke-materials-only",
  version: "1.0.0",
});

try {
  await client.connect(delegatedTransport(accessToken));
  // Состав набора инструментов сверяет `pnpm mcp:check`; здесь важно, что развёрнутый сервер отвечает.
  const tools = await client.listTools();
  if (tools.tools.length === 0) {
    throw new Error("MCP server exposed no tools");
  }

  // Видимость инструмента и разрешение `materials:manage` не дают автору полномочий коммуникаций.
  // Ожидаемый код отказа приходит из контракта модуля, поэтому смена контракта меняет и сервер,
  // и эту проверку.
  await materialsOnlyClient.connect(delegatedTransport(materialsOnlyAccessToken));
  const denied = await callTool(
    "communications_templates_list",
    {
      operationId: "73000000-0000-4000-8000-000000000003",
      expectedRevision: 0,
      payload: {},
    },
    materialsOnlyClient,
  );
  assertField(denied, "isError", true, "communications permission denial");
  const denial = z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: z.literal(COMMUNICATIONS_PERMISSION_DENIED) }),
  });
  denial.parse(denied.structuredContent);

  const initialMetadata = metadata("free");
  const created = successfulValue(
    await callTool("material_create_draft", {
      idempotencyKey: "full-stack-mcp-create-v1",
      metadata: initialMetadata,
      body,
    }),
    "create draft",
  );
  const materialId = requireString(created, "materialId", "create draft");

  const loaded = successfulValue(
    await callTool("material_load", { materialId }),
    "load current Material",
  );
  const currentVersion = requirePositiveInteger(
    loaded,
    "contentVersion",
    "load current Material",
  );
  const published = successfulValue(
    await callTool("material_save", {
      primaryVideoId: null,
      idempotencyKey: `full-stack-mcp-publish-from-${String(currentVersion)}`,
      materialId,
      expectedContentVersion: currentVersion,
      publicationState: "published",
      metadata: metadata("membership"),
      body,
    }),
    "publish Material",
  );
  const publishedVersion = requirePositiveInteger(
    published,
    "contentVersion",
    "publish Material",
  );
  assertField(published, "publicationState", "published", "publish Material");

  const preview = successfulValue(
    await callTool("material_preview", { materialId }),
    "preview Material",
  );
  assertField(preview, "contentVersion", publishedVersion, "preview Material");
  assertField(preview, "cacheScope", "private-no-store", "preview Material");
  const previewMetadata = z
    .record(z.string(), z.unknown())
    .parse(preview.metadata);
  assertField(previewMetadata, "access", "membership", "preview Material");

  const unpublished = successfulValue(
    await callTool("material_save", {
      primaryVideoId: null,
      idempotencyKey: `full-stack-mcp-unpublish-from-${String(publishedVersion)}`,
      materialId,
      expectedContentVersion: publishedVersion,
      publicationState: "unpublished",
      metadata: metadata("free"),
      body,
    }),
    "unpublish Material",
  );
  assertField(
    unpublished,
    "publicationState",
    "unpublished",
    "unpublish Material",
  );

  process.stdout.write(
    `MCP authoring smoke passed: ${materialId} published, previewed and unpublished\n`,
  );
} finally {
  await Promise.all([client.close(), materialsOnlyClient.close()]);
}

function delegatedTransport(token: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(serverUrl), {
    authProvider: { token: () => Promise.resolve(token) },
  });
}

function metadata(access: "free" | "membership") {
  return {
    title: "MCP full-stack authoring smoke",
    summary: "A stable Material used to verify delegated MCP authoring.",
    access,
    difficulty: "basic",
    // Публикация принимает либо пустой список обещаний, либо настоящий: одна строка её не пройдёт.
    outcomes: [
      "Собрать материал через делегированный MCP.",
      "Проверить публикацию и предпросмотр на живом стенде.",
    ],
    topicId,
    formatId,
    tagIds: [],
    seriesIds: [],
  };
}

function callTool(
  name: string,
  arguments_: Record<string, unknown>,
  delegate: Client = client,
): Promise<CallToolResult> {
  return delegate.callTool({ name, arguments: arguments_ });
}

function successfulValue(
  result: CallToolResult,
  operation: string,
): Record<string, unknown> {
  const structured = result.structuredContent;
  if (
    structured === undefined ||
    structured === null ||
    typeof structured !== "object" ||
    !("ok" in structured) ||
    structured.ok !== true ||
    !("value" in structured) ||
    structured.value === null ||
    typeof structured.value !== "object" ||
    Array.isArray(structured.value)
  ) {
    throw new Error(`${operation} failed: ${failureReason(result)}`);
  }
  return z.record(z.string(), z.unknown()).parse(structured.value);
}

/**
 * Отказ до обработчика приходит без `structuredContent`, и тогда причина есть только в тексте
 * ответа. Без неё падение смоука называет `undefined` вместо того, что отклонил сервер.
 */
function failureReason(result: CallToolResult): string {
  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  const reported = result.content
    .map((block) => (block.type === "text" ? block.text : block.type))
    .join("; ");
  return reported.length > 0 ? reported : JSON.stringify(result);
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  operation: string,
): string {
  const actual = value[field];
  if (typeof actual !== "string") {
    throw new Error(`${operation} returned no ${field}`);
  }
  return actual;
}

function requirePositiveInteger(
  value: Record<string, unknown>,
  field: string,
  operation: string,
): number {
  const actual = value[field];
  if (typeof actual !== "number" || !Number.isInteger(actual) || actual < 1) {
    throw new Error(`${operation} returned invalid ${field}`);
  }
  return actual;
}

function assertField(
  value: Record<string, unknown>,
  field: string,
  expected: unknown,
  operation: string,
): void {
  if (value[field] !== expected) {
    throw new Error(
      `${operation} returned unexpected ${field}: ${JSON.stringify(value[field])}`,
    );
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
