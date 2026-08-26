import { afterEach, describe, expect, it, vi } from "vitest";

import {
  establishAccount,
  resolveAccount,
} from "@/shared/api/backend/index.server";

const token = "header.payload.signature";
const account = { accountId: "72000000-0000-4000-8000-000000000002" };

describe("Account backend interface", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("establishes and resolves an Account without a second session credential", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ account })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(establishAccount(token)).resolves.toEqual(account);
    await expect(resolveAccount(token)).resolves.toEqual(account);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://platform-api.example.test/accounts",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://platform-api.example.test/accounts/current",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  });

  it("fails closed on an unexpected response and distinguishes rejection", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ account: { ...account, providerRole: "admin" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveAccount(token)).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(establishAccount(token)).rejects.toMatchObject({
      code: "rejected",
    });
  });
});
