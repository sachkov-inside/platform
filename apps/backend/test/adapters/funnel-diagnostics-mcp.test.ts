import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { assembleInsideMcpServer } from "../../src/entrypoints/mcp/inside-mcp-server.js";
import { refusingMcpToolDependencies } from "../fixtures/inside-mcp-dependencies.js";
import { assembleTestFunnel } from "../fixtures/sales-funnel.js";
import { diagnosticDatabase } from "../fixtures/payment-diagnostics-database.js";

it("registers the bounded funnel diagnostic and refuses a non-admin delegated Account", async () => {
  const server = assembleInsideMcpServer({
    ...refusingMcpToolDependencies(),
    accountId: "10000000-0000-4000-8000-000000000001",
    funnel: assembleTestFunnel(
      diagnosticDatabase({ permissionGranted: false }),
    ),
  });
  const client = new Client({
    name: "funnel-diagnostics-contract",
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
      tools.find((tool) => tool.name === "sales_funnel_diagnostics"),
    ).toMatchObject({
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    expect(
      await client.callTool({
        name: "sales_funnel_diagnostics",
        arguments: { from: "2026-10-18T21:00:00Z", to: "2026-10-19T21:00:00Z" },
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
  } finally {
    await client.close();
    await server.close();
  }
});
