import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import { assembleInsideMcpServer } from "../../src/entrypoints/mcp/inside-mcp-server.js";
import { QueueDiagnostics } from "../../src/entrypoints/mcp/queue-diagnostics.js";
import { refusingMcpToolDependencies } from "../fixtures/inside-mcp-dependencies.js";

it("publishes only a strict read-only diagnostic and checks delegated permission before private reads", async () => {
  const read = vi
    .fn()
    .mockRejectedValue(new Error("private read must not happen"));
  const permission = vi.fn().mockResolvedValue({ ok: true, allowed: false });
  const server = assembleInsideMcpServer({
    ...refusingMcpToolDependencies(),
    accountId: "10000000-0000-4000-8000-000000000001",
    queues: new QueueDiagnostics({ checkPermission: permission }, { read }),
  });
  const client = new Client({
    name: "queue-diagnostics-contract",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === "operational_queue_diagnostics"),
    ).toMatchObject({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    });
    expect(
      await client.callTool({
        name: "operational_queue_diagnostics",
        arguments: {},
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
    expect(permission).toHaveBeenCalledWith({
      accountId: "10000000-0000-4000-8000-000000000001",
      permission: "platform:admin",
    });
    expect(read).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
});
