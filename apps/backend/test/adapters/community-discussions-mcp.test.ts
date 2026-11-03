import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { afterEach, expect, test, vi } from "vitest";
import { assembleInsideMcpServer } from "../../src/entrypoints/mcp/inside-mcp-server.js";
import { refusingMcpToolDependencies } from "../fixtures/inside-mcp-dependencies.js";

let server: McpServer | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await server?.close();
});

test("the author MCP exposes three discussion tools and binds its delegated Account", async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { code: "forbidden" } });
  server = assembleInsideMcpServer({
    accountId: "delegated-account",
    ...refusingMcpToolDependencies(),
    communityDiscussions: { execute },
  });
  client = new Client({ name: "community-discussions-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const tools = (await client.listTools()).tools.filter((tool) =>
    tool.name.startsWith("community_discussions_"),
  );
  expect(tools.map((tool) => tool.name)).toEqual([
    "community_discussions_list",
    "community_discussions_read",
    "community_discussions_mark",
  ]);
  expect(tools.map((tool) => tool.annotations?.readOnlyHint)).toEqual([
    true,
    true,
    false,
  ]);
  for (const tool of tools)
    expect(tool.inputSchema.properties).not.toHaveProperty("actor");
  expect(
    await client.callTool({
      name: "community_discussions_list",
      arguments: { requestId: "list-1", limit: 20 },
    }),
  ).toMatchObject({
    isError: true,
    structuredContent: { ok: false, error: { code: "forbidden" } },
  });
  expect(execute).toHaveBeenCalledWith("delegated-account", {
    contractVersion: "inside.community-discussions.v1",
    operation: "discussions.list",
    requestId: "list-1",
    limit: 20,
  });
  await client.callTool({
    name: "community_discussions_list",
    arguments: {
      requestId: "list-1",
      limit: 20,
      actor: { accountRef: "forged" },
    },
  });
  await client.callTool({
    name: "community_discussions_list",
    arguments: { requestId: "list-1", limit: 20, accountId: "forged" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  await client.callTool({
    name: "community_discussions_list",
    arguments: {
      requestId: "changes-1",
      limit: 20,
      unreviewedOnly: true,
      changedSince: "2026-11-01T12:00:00Z",
    },
  });
  expect(execute).toHaveBeenLastCalledWith("delegated-account", {
    contractVersion: "inside.community-discussions.v1",
    operation: "discussions.list",
    requestId: "changes-1",
    limit: 20,
    unreviewedOnly: true,
    changedSince: "2026-11-01T12:00:00Z",
  });
  await client.callTool({
    name: "community_discussions_mark",
    arguments: {
      requestId: "review-1",
      discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "reviewed",
      materialUrls: [],
      expectedRevision: 2,
    },
  });
  expect(execute).toHaveBeenLastCalledWith("delegated-account", {
    contractVersion: "inside.community-discussions.v1",
    operation: "discussions.mark",
    requestId: "review-1",
    discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "reviewed",
    materialUrls: [],
    expectedRevision: 2,
  });
});
