import { OAuthErrorCode } from "@modelcontextprotocol/server";
import { describe, expect, test } from "vitest";

import { assembleDelegatedAccountTokenVerifier } from "../../src/modules/accounts/index.js";
import { verifiedAccountIdentity } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";

const identity = verifiedAccountIdentity({
  issuer: "https://identity.example.test/oidc",
  subject: "owner-001",
});

describe("MCP delegated Account token verifier", () => {
  test("keeps provider scopes out and carries only the resolved Account context", async () => {
    const verifier = assembleDelegatedAccountTokenVerifier({
      tokenVerifier: {
        verifyAccount: () =>
          Promise.resolve({ ok: true, identity, expiresAt: 2_000_000_000 }),
      },
      accounts: {
        resolveAccount: () =>
          Promise.resolve({
            ok: true,
            account: { accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
          }),
      },
    });

    await expect(verifier.verifyAccessToken("delegated-token")).resolves.toEqual({
      token: "delegated-token",
      clientId: "inside-platform-user-delegation",
      scopes: [],
      expiresAt: 2_000_000_000,
      extra: { accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
  });

  test.each([
    [
      "invalid proof",
      { ok: false as const, error: { code: "invalid_proof" as const } },
      OAuthErrorCode.InvalidToken,
    ],
    [
      "identity dependency",
      { ok: false as const, error: { code: "dependency_unavailable" as const } },
      OAuthErrorCode.ServerError,
    ],
  ])("maps %s without exposing proof details", async (_name, proof, code) => {
    const verifier = assembleDelegatedAccountTokenVerifier({
      tokenVerifier: { verifyAccount: () => Promise.resolve(proof) },
      accounts: {
        resolveAccount: () =>
          Promise.resolve({
            ok: true,
            account: { accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
          }),
      },
    });

    await expect(verifier.verifyAccessToken("rejected-token")).rejects.toMatchObject({
      code,
    });
  });

  test("rejects a valid proof for an unknown Account", async () => {
    const verifier = assembleDelegatedAccountTokenVerifier({
      tokenVerifier: {
        verifyAccount: () =>
          Promise.resolve({ ok: true, identity, expiresAt: 2_000_000_000 }),
      },
      accounts: {
        resolveAccount: () =>
          Promise.resolve({
            ok: false,
            error: { code: "account_not_found" },
          }),
      },
    });

    await expect(verifier.verifyAccessToken("unknown-account")).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
    });
  });
});
