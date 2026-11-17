import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleIssueProductAccess,
  handleRestoreProductAccess,
} from "@/entities/subscription/api/product-access.server";
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
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession("owner-token");
  vi.stubGlobal("fetch", backend);
});
afterEach(() => vi.useRealTimers());

it("issues only the selected Product, preserving the source and reason without client time authority", async () => {
  const input = {
    accountId,
    productId,
    sourceRef: "course-owner-review",
    reason: "Подтверждение владельца",
  };
  backend.mockResolvedValueOnce(
    Response.json({
      ok: true,
      outcome: "issued",
      value: {
        accountId,
        productId,
        access: "active",
        firstIssuedAt: "2026-10-23T10:00:00Z",
        revision: 1,
      },
    }),
  );
  expect(
    await (
      await session(() => handleIssueProductAccess(command(input)))
    ).json(),
  ).toMatchObject({ ok: true, value: { outcome: "issued" } });
  expect(backend).toHaveBeenCalledOnce();
  const sent = backend.mock.calls[0]?.[0];
  expect(sent?.method).toBe("POST");
  expect(sent?.url).toBe(
    "https://platform-api.example.test/admin/access/products/issue",
  );
  expect(sent?.headers.get("authorization")).toBe("Bearer owner-token");
  expect(await sent?.json()).toEqual(input);
  backend.mockClear();
  expect(
    await (
      await session(() =>
        handleIssueProductAccess(
          command({ ...input, issuedAt: "2020-01-01T00:00:00Z" }),
        ),
      )
    ).json(),
  ).toMatchObject({ ok: false, code: "invalid_request" });
  expect(backend).not.toHaveBeenCalled();
});
it("requires revision and reason for an explicit restoration", async () => {
  const response = await session(() =>
    handleRestoreProductAccess(
      command({ accountId, productId, reason: "Restore" }),
    ),
  );
  expect(await response.json()).toMatchObject({
    ok: false,
    code: "invalid_request",
  });
  expect(backend).not.toHaveBeenCalled();
});
it("keeps authentication, Origin and backend owner permission on the actual access boundary", async () => {
  const input = {
    accountId,
    productId,
    sourceRef: "owner-dialog-1",
    reason: "Подарок",
  };
  expect(
    (
      await session(() =>
        handleIssueProductAccess(command(input, "https://other.example")),
      )
    ).status,
  ).toBe(403);
  expect(backend).not.toHaveBeenCalled();
  backend.mockResolvedValueOnce(
    Response.json({ code: "forbidden" }, { status: 403 }),
  );
  const denial = await session(() => handleIssueProductAccess(command(input)));
  expect(await denial.json()).toMatchObject({ ok: false, code: "forbidden" });
  session = await realBffSession(null);
  const response = await session(() =>
    handleIssueProductAccess(command(input)),
  );
  expect(response.status).toBe(401);
  expect(backend).toHaveBeenCalledTimes(1);
});
