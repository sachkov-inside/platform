import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import {
  ActivityRetentionDiagnostics,
  registerActivityRetentionDiagnosticsTool,
} from "../../src/entrypoints/mcp/activity-retention-diagnostics.js";
it("checks current delegated admin before retention reads and exposes no cleanup or actor override", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const status = vi.fn().mockRejectedValue(new Error("private"));
  const permission = vi.fn().mockResolvedValue({ ok: true, allowed: false });
  const readReceipt = vi
    .fn()
    .mockRejectedValue(new Error("private receipt must not be read"));
  const server = new McpServer({ name: "retention", version: "1" });
  registerActivityRetentionDiagnosticsTool(server, {
    accountId: actor,
    retention: new ActivityRetentionDiagnostics(
      { checkPermission: permission },
      { status },
      { status },
      { readActivityRetentionLastPass: readReceipt },
    ),
  });
  const client = new Client({ name: "retention-contract", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(st), client.connect(ct)]);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "activity_retention_diagnostics",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: { additionalProperties: false },
    });
    expect(
      await client.callTool({
        name: "activity_retention_diagnostics",
        arguments: {},
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
    expect(permission).toHaveBeenCalledWith({
      accountId: actor,
      permission: "platform:admin",
    });
    permission.mockClear();
    expect(
      await client.callTool({
        name: "activity_retention_diagnostics",
        arguments: { accountId: actor },
      }),
    ).toMatchObject({ isError: true });
    expect(permission).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(readReceipt).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
});
it("keeps source failure distinct from a known empty backlog and does not return private errors", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const missingReceipt = {
    ok: false as const,
    status: "unknown" as const,
    error: { code: "no_retained_pass" as const },
  };
  const readReceipt = vi.fn().mockResolvedValue(missingReceipt);
  const diagnostics = new ActivityRetentionDiagnostics(
    { checkPermission: vi.fn().mockResolvedValue({ ok: true, allowed: true }) },
    {
      status: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          status: "known",
          asOf: "2026-10-21T00:00:00.123456Z",
          cutoff: "2025-10-21T00:00:00.123456Z",
          hasMore: false,
          oldestExpiredAt: null,
          lagSeconds: null,
        },
      }),
    },
    { status: vi.fn().mockRejectedValue(new Error(`private ${actor}`)) },
    { readActivityRetentionLastPass: readReceipt },
  );
  const result = await diagnostics.read(actor, {});
  expect(result).toMatchObject({
    ok: true,
    value: {
      sources: [
        {
          source: "learning_started",
          result: {
            ok: true,
            value: { status: "known", hasMore: false, lagSeconds: null },
          },
        },
        {
          source: "bookmarks",
          result: {
            ok: false,
            status: "unknown",
            error: { code: "source_unavailable" },
          },
        },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain(actor);
});
it("rechecks authorization after revocation and rejects invalid direct inputs before all private reads", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const status = vi.fn().mockResolvedValue({
    ok: false,
    status: "unknown",
    error: { code: "source_unavailable" },
  });
  const permission = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, allowed: true })
    .mockResolvedValueOnce({ ok: true, allowed: false })
    .mockResolvedValueOnce({ ok: false, error: { code: "internal_error" } });
  const missingReceipt = {
    ok: false as const,
    status: "unknown" as const,
    error: { code: "no_retained_pass" as const },
  };
  const readReceipt = vi.fn().mockResolvedValue(missingReceipt);
  const diagnostics = new ActivityRetentionDiagnostics(
    { checkPermission: permission },
    { status },
    { status },
    { readActivityRetentionLastPass: readReceipt },
  );
  expect(await diagnostics.read(actor, {})).toMatchObject({ ok: true });
  status.mockClear();
  expect(await diagnostics.read(actor, {})).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(await diagnostics.read(actor, {})).toEqual({
    ok: false,
    error: { code: "dependency_unavailable" },
  });
  expect(await diagnostics.read("invalid", {})).toEqual({
    ok: false,
    error: { code: "invalid_request" },
  });
  expect(await diagnostics.read(actor, { clean: true })).toEqual({
    ok: false,
    error: { code: "invalid_request" },
  });
  expect(status).not.toHaveBeenCalled();
  expect(permission).toHaveBeenCalledTimes(3);
  expect(readReceipt).toHaveBeenCalledOnce();
});
it("starts all independent reads behind one authorization before releasing any held result", async () => {
  const started: string[] = [];
  const held = <T>(name: string) => {
    let release!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
      release = resolve;
    });
    return {
      read: () => {
        started.push(name);
        return promise;
      },
      release,
    };
  };
  const known = {
    ok: true as const,
    value: {
      status: "known" as const,
      asOf: "2026-10-21T00:00:00.000000Z",
      cutoff: "2025-10-21T00:00:00.000000Z",
      hasMore: false,
      oldestExpiredAt: null,
      lagSeconds: null,
    },
  };
  const reading = held<typeof known>("reading"),
    bookmarks = held<typeof known>("bookmarks");
  const receipt = held<{
    ok: false;
    status: "unknown";
    error: { code: "no_retained_pass" };
  }>("receipt");
  const permission = vi.fn().mockResolvedValue({ ok: true, allowed: true });
  const diagnostics = new ActivityRetentionDiagnostics(
    { checkPermission: permission },
    { status: reading.read },
    { status: bookmarks.read },
    { readActivityRetentionLastPass: receipt.read },
  );
  const pending = diagnostics.read("10000000-0000-4000-8000-000000000001", {});
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["reading", "bookmarks", "receipt"]);
  } finally {
    reading.release(known);
    bookmarks.release(known);
    receipt.release({
      ok: false,
      status: "unknown",
      error: { code: "no_retained_pass" },
    });
  }
  expect(await pending).toMatchObject({
    ok: true,
    value: {
      sources: [
        { source: "learning_started", result: { ok: true } },
        { source: "bookmarks", result: { ok: true } },
      ],
      lastPass: { ok: false, error: { code: "no_retained_pass" } },
    },
  });
  expect(permission).toHaveBeenCalledOnce();
});
