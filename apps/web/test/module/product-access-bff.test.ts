import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  issue: vi.fn(),
  restore: vi.fn(),
  read: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestIssueProductAccess: fakes.issue,
  requestRestoreProductAccess: fakes.restore,
  requestReadProductAccess: fakes.read,
  requestListProductAccess: fakes.list,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));
import {
  handleIssueProductAccess,
  handleRestoreProductAccess,
  handleReadProductAccess,
} from "@/features/billing-admin/api/product-access.server";
const accountId = "00000000-0000-4000-8000-000000000001",
  productId = "00000000-0000-4000-8000-000000000002";
function command(input: unknown, origin = "https://inside.example.test") {
  return new Request(
    "https://inside.example.test/api/authoring/access/products/issue",
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("owner-token");
});
it("issues only the selected Product, preserving the source and reason without client time authority", async () => {
  const input = {
    accountId,
    productId,
    sourceRef: "course-owner-review",
    reason: "Подтверждение владельца",
  };
  fakes.issue.mockResolvedValue({
    ok: true,
    body: {
      ok: true,
      outcome: "issued",
      value: {
        accountId,
        productId,
        access: "active",
        firstIssuedAt: "2026-10-23T10:00:00Z",
        revision: 1,
      },
    },
    response: new Response(),
  });
  expect(
    await (await handleIssueProductAccess(command(input))).json(),
  ).toMatchObject({ ok: true, value: { outcome: "issued" } });
  expect(fakes.issue).toHaveBeenCalledExactlyOnceWith(input, "owner-token");
  fakes.issue.mockClear();
  expect(
    await (
      await handleIssueProductAccess(
        command({ ...input, issuedAt: "2020-01-01T00:00:00Z" }),
      )
    ).json(),
  ).toMatchObject({ ok: false, code: "invalid_request" });
  expect(fakes.issue).not.toHaveBeenCalled();
});
it("requires revision and reason for an explicit restoration", async () => {
  const response = await handleRestoreProductAccess(
    command({ accountId, productId, reason: "Restore" }),
  );
  expect(await response.json()).toMatchObject({
    ok: false,
    code: "invalid_request",
  });
  expect(fakes.restore).not.toHaveBeenCalled();
});
it("keeps authentication, Origin and backend owner permission on the actual access boundary", async () => {
  const pair = { accountId, productId };
  expect(
    (await handleReadProductAccess(command(pair, "https://other.example")))
      .status,
  ).toBe(403);
  expect(fakes.read).not.toHaveBeenCalled();
  fakes.read.mockResolvedValue({
    ok: false,
    problem: { code: "forbidden" },
    response: new Response(null, { status: 403 }),
  });
  const denial = await handleReadProductAccess(command(pair));
  expect(await denial.json()).toMatchObject({ ok: false, code: "forbidden" });
  const { LogtoSessionUnavailableError } =
    await import("@/shared/auth/session-adapter.server");
  fakes.token.mockRejectedValue(new LogtoSessionUnavailableError());
  const response = await handleReadProductAccess(command(pair));
  expect(response.status).toBe(401);
  expect(fakes.read).toHaveBeenCalledTimes(1);
});
it("preserves an unknown historical issuance date through the owner read boundary", async () => {
  fakes.read.mockResolvedValue({
    ok: true,
    body: {
      ok: true,
      value: {
        accountId,
        productId,
        access: "revoked",
        firstIssuedAt: null,
        revision: 1,
        sources: [],
        actions: [],
      },
    },
    response: new Response(),
  });
  expect(
    await (
      await handleReadProductAccess(command({ accountId, productId }))
    ).json(),
  ).toMatchObject({ ok: true, value: { value: { firstIssuedAt: null } } });
});
