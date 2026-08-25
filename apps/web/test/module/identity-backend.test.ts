import { afterEach, describe, expect, it, vi } from "vitest";

import {
  endIdentitySession,
  establishIdentitySession,
  resolveIdentitySubject,
} from "@/shared/api/backend/index.server";

const token = "header.payload.signature";
const sessionRef = "72000000-0000-4000-8000-000000000001";
const subject = {
  principalId: "72000000-0000-4000-8000-000000000002",
  principalKind: "human" as const,
  sessionRef,
  authenticatedAt: "2026-08-25T06:00:00.000Z",
  expiresAt: "2026-09-01T06:00:00.000Z",
  permissions: [] as const,
};

describe("identity backend interface", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("establishes a session without exposing the bearer in the result", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ subject }, { status: 201 }),
      ),
    );

    await expect(
      establishIdentitySession({ accessToken: token, idempotencyKey: "attempt-001" }),
    ).resolves.toEqual(subject);
    expect(fetch).toHaveBeenCalledWith(
      "https://platform-api.example.test/identity/sessions/human",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "attempt-001",
        },
      }),
    );
  });

  it("resolves and ends the same opaque session boundary", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ subject }))
      .mockResolvedValueOnce(Response.json({ ended: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveIdentitySubject({ accessToken: token, sessionRef }),
    ).resolves.toEqual(subject);
    await expect(
      endIdentitySession({
        accessToken: token,
        idempotencyKey: "sign-out-001",
        sessionRef,
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://platform-api.example.test/identity/subject",
      expect.objectContaining({
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-platform-session": sessionRef,
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://platform-api.example.test/identity/sessions/current",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("fails closed on an unexpected identity response", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ token }, { status: 200 })));

    await expect(
      resolveIdentitySubject({ accessToken: token, sessionRef }),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("distinguishes a rejected proof from a retryable backend outage", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      establishIdentitySession({ accessToken: token, idempotencyKey: "rejected-proof" }),
    ).rejects.toMatchObject({ code: "rejected" });
    await expect(
      establishIdentitySession({ accessToken: token, idempotencyKey: "retryable-outage" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
