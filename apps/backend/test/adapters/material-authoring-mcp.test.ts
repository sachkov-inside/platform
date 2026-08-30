import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, test } from "vitest";

import {
  assembleMaterialAuthoringMcpServer,
  type MaterialAuthoring,
} from "../../src/modules/materials/index.js";
import {
  forbiddenAuthoringResult,
  stubMaterialAuthoring,
} from "../fixtures/material-authoring.js";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("Material authoring MCP adapter", () => {
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  test("exposes only create, load, full-state Save, and current Preview", async () => {
    ({ client, server } = await connect(stubMaterialAuthoring()));

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "material_create_draft",
      "material_load",
      "material_save",
      "material_preview",
    ]);
    expect(tools.find(({ name }) => name === "material_save")?.annotations)
      .toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(tools.some(({ name }) => name.includes("sql"))).toBe(false);
  });

  test("injects the delegated Account and preserves application errors", async () => {
    let receivedAccountId: string | undefined;
    ({ client, server } = await connect(
      stubMaterialAuthoring({
        createDraft: (command) => {
          receivedAccountId = command.actor;
          return Promise.resolve(forbiddenAuthoringResult);
        },
      }),
    ));

    const result = await client.callTool({
      name: "material_create_draft",
      arguments: {
        idempotencyKey: "mcp-create-1",
        metadata: incompleteMetadata("MCP draft"),
        body: emptyBody(),
      },
    });

    expect(receivedAccountId).toBe(accountId);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "forbidden" },
      },
    });
  });

  test("returns successful application values as structured content", async () => {
    ({ client, server } = await connect(
      stubMaterialAuthoring({
        loadMaterial: ({ materialId }) => Promise.resolve({
          ok: true,
          value: {
            materialId,
            contentVersion: 4,
            publicationState: "unpublished",
            firstPublishedAt: "2026-08-30T10:00:00.000Z",
            publishedAt: null,
            metadata: incompleteMetadata("Loaded"),
            body: emptyBody(),
          },
        }),
      }),
    ));

    const result = await client.callTool({
      name: "material_load",
      arguments: { materialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    });

    expect(result).toMatchObject({
      structuredContent: {
        ok: true,
        value: { contentVersion: 4, publicationState: "unpublished" },
      },
    });
    expect(result.isError).not.toBe(true);
  });
});

async function connect(authoring: MaterialAuthoring): Promise<{
  readonly client: Client;
  readonly server: McpServer;
}> {
  const connectedClient = new Client({ name: "platform-test", version: "1.0.0" });
  const connectedServer = assembleMaterialAuthoringMcpServer({
    accountId,
    authoring,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    connectedClient.connect(clientTransport),
    connectedServer.connect(serverTransport),
  ]);
  return { client: connectedClient, server: connectedServer };
}

function incompleteMetadata(title: string) {
  return {
    title,
    summary: null,
    slug: null,
    access: "free" as const,
    topicId: null,
    formatId: null,
    tagIds: [],
    seriesMemberships: [],
  };
}

function emptyBody() {
  return { schemaVersion: 1 as const, doc: { type: "doc", content: [] } };
}
