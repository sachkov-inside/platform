import { expect, it, vi } from "vitest";
import { QueueDiagnostics } from "../../src/entrypoints/mcp/queue-diagnostics.js";

const actor = "10000000-0000-4000-8000-000000000001";
it("denies non-admin before any private queue reads", async () => {
  const read = vi
    .fn()
    .mockRejectedValue(new Error("private read must not happen"));
  const permission = vi.fn().mockResolvedValue({ ok: true, allowed: false });
  const diagnostics = new QueueDiagnostics(
    { checkPermission: permission },
    { read },
  );
  expect(await diagnostics.read(actor, {})).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(read).not.toHaveBeenCalled();
});

it("rejects caller-selected queues and actor overrides before private reads", async () => {
  const read = vi
    .fn()
    .mockRejectedValue(new Error("private read must not happen"));
  const permission = vi.fn().mockResolvedValue({ ok: true, allowed: true });
  const diagnostics = new QueueDiagnostics(
    { checkPermission: permission },
    { read },
  );
  expect(
    await diagnostics.read(actor, {
      accountId: actor,
      queue: "billing.payment-recovery",
    }),
  ).toEqual({ ok: false, error: { code: "invalid_request" } });
  expect(await diagnostics.read("not-an-account", {})).toEqual({
    ok: false,
    error: { code: "invalid_request" },
  });
  expect(permission).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("does not treat unavailable authorization as permission", async () => {
  const read = vi
    .fn()
    .mockRejectedValue(new Error("private read must not happen"));
  const permission = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { code: "internal_error" } });
  const diagnostics = new QueueDiagnostics(
    { checkPermission: permission },
    { read },
  );
  expect(await diagnostics.read(actor, {})).toEqual({
    ok: false,
    error: { code: "dependency_unavailable" },
  });
  expect(read).not.toHaveBeenCalled();
});
