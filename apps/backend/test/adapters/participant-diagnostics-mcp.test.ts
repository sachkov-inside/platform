import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import {
  ParticipantDiagnostics,
  registerParticipantDiagnosticsTool,
} from "../../src/entrypoints/mcp/participant-diagnostics.js";

it("registers aggregate-only activity for the trusted delegated Account and rejects actor override", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const read = vi.fn().mockRejectedValue(new Error("private source"));
  const permission = vi.fn().mockResolvedValue({ ok: true, allowed: false });
  const server = new McpServer({ name: "participants", version: "1" });
  registerParticipantDiagnosticsTool(server, {
    accountId: actor,
    participants: new ParticipantDiagnostics(
      { checkPermission: permission },
      { read },
      { read },
      { read },
    ),
  });
  const client = new Client({ name: "participant-contract", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "active_participant_diagnostics",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: { additionalProperties: false },
    });
    const window = { from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z" };
    expect(
      await client.callTool({
        name: "active_participant_diagnostics",
        arguments: window,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
    permission.mockClear();
    expect(
      await client.callTool({
        name: "active_participant_diagnostics",
        arguments: { ...window, accountId: actor },
      }),
    ).toMatchObject({ isError: true });
    expect(permission).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
});
