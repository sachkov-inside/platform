import process from "node:process";

import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { z } from "zod";

const serverUrl = requireEnvironment("MCP_SMOKE_SERVER_URL");
const accessToken = requireEnvironment("MCP_SMOKE_ACCESS_TOKEN");
const topicId = "72000000-0000-4000-8000-000000000002";
const formatId = "72000000-0000-4000-8000-000000000003";
const slug = "mcp-full-stack-authoring-smoke";
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

try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(serverUrl), {
      authProvider: { token: () => Promise.resolve(accessToken) },
    }),
  );
  const tools = await client.listTools();
  const toolNames = tools.tools.map(({ name }) => name).sort();
  assertEqual(
    toolNames,
    [
      "material_create_draft",
      "material_load",
      "material_preview",
      "material_save",
    ],
    "MCP tool surface",
  );

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
  await client.close();
}

function metadata(access: "free" | "membership") {
  return {
    title: "MCP full-stack authoring smoke",
    summary: "A stable Material used to verify delegated MCP authoring.",
    slug,
    access,
    topicId,
    formatId,
    tagIds: [],
    seriesMemberships: [],
  };
}

function callTool(
  name: string,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  return client.callTool({ name, arguments: arguments_ });
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
    throw new Error(
      `${operation} failed: ${JSON.stringify(result.structuredContent)}`,
    );
  }
  return z.record(z.string(), z.unknown()).parse(structured.value);
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

function assertEqual(
  actual: readonly string[],
  expected: readonly string[],
  description: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected ${description}: ${JSON.stringify(actual)}`,
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
