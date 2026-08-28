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
    const fetchMock = vi.fn((request: Request) => {
      return Promise.resolve(
        Response.json(
          { account },
          { status: request.method === "POST" ? 201 : 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(establishAccount(token)).resolves.toEqual(account);
    await expect(resolveAccount(token)).resolves.toEqual(account);
    const establishRequest = fetchMock.mock.calls[0]?.[0];
    const resolveRequest = fetchMock.mock.calls[1]?.[0];
    expect(establishRequest).toMatchObject({
      method: "POST",
      url: "https://platform-api.example.test/accounts",
    });
    expect(establishRequest?.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(resolveRequest).toMatchObject({
      method: "GET",
      url: "https://platform-api.example.test/accounts/current",
    });
    expect(resolveRequest?.headers.get("authorization")).toBe(`Bearer ${token}`);
  });

  it("fails closed on unexpected success and error responses", async () => {
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
      code: "backend-error",
    });
  });

  it("maps only validated Account Problem Details to known outcomes", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const problem = (code: "dependency_unavailable" | "invalid_proof") => ({
      type: `https://inside.sachkov.com/problems/accounts/${code.replaceAll("_", "-")}`,
      title:
        code === "dependency_unavailable"
          ? "Identity provider unavailable"
          : "Account verification failed",
      status: code === "dependency_unavailable" ? 503 : 401,
      detail: "Account request could not be completed.",
      code,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(problem("invalid_proof"), {
            status: 401,
            headers: { "Content-Type": "application/problem+json" },
          }),
        )
        .mockResolvedValueOnce(
          Response.json(problem("dependency_unavailable"), {
            status: 503,
            headers: { "Content-Type": "application/problem+json" },
          }),
        ),
    );

    await expect(resolveAccount(token)).rejects.toMatchObject({ code: "rejected" });
    await expect(establishAccount(token)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
