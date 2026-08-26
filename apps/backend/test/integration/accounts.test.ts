import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { Accounts } from "../../src/modules/accounts/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  verifiedAccountIdentity,
  verifiedAccountSignIn,
} from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import { bootstrapOwnerAccount } from "../../src/modules/accounts/features/bootstrap-owner-account/bootstrap-owner-account.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const fingerprintKey = "accounts-test-email-fingerprint-key";

describe("Accounts", () => {
  let accounts: Accounts;
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: fingerprintKey,
    });
  });

  afterAll(async () => database.dispose());

  test("creates one Account and resolves only a known Logto identity", async () => {
    const proof = verifiedAccountSignIn({
      issuer,
      subject: "human-first",
      verifiedEmail: "Member@Example.Test",
    });
    const first = await accounts.establishAccount({ identity: proof.identity });
    const returning = await accounts.establishAccount({ identity: proof.identity });

    expect(first.ok).toBe(true);
    expect(returning).toEqual(first);
    if (!first.ok) return;
    await expect(
      accounts.resolveAccount({ identity: proof.accountIdentity }),
    ).resolves.toEqual({ ok: true, account: first.account });
    await expect(
      accounts.resolveAccount({
        identity: verifiedAccountIdentity({ issuer, subject: "unknown" }),
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "account_not_found" },
    });
  });

  test("arbitrates concurrent first sign-in with one Account", async () => {
    const proof = verifiedAccountSignIn({
      issuer,
      subject: "human-concurrent",
      verifiedEmail: "concurrent@example.test",
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        accounts.establishAccount({ identity: proof.identity }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const ids = new Set(
      results.flatMap((result) => (result.ok ? [result.account.accountId] : [])),
    );
    expect(ids.size).toBe(1);
    await expect(
      database.prisma.account.count({
        where: { logtoSubject: "human-concurrent" },
      }),
    ).resolves.toBe(1);
  });

  test("rejects a new subject with the same verified email and audits without PII", async () => {
    const email = "duplicate@example.test";
    const first = verifiedAccountSignIn({
      issuer,
      subject: "duplicate-owner",
      verifiedEmail: email,
    });
    const second = verifiedAccountSignIn({
      issuer,
      subject: "duplicate-rejected",
      verifiedEmail: email,
    });
    await accounts.establishAccount({ identity: first.identity });

    await expect(
      accounts.establishAccount({ identity: second.identity }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "identity_conflict" },
    });
    await expect(
      database.prisma.account.findUnique({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: issuer,
            logtoSubject: "duplicate-rejected",
          },
        },
      }),
    ).resolves.toBeNull();
    const audit = await database.prisma.accountAuditEvent.findFirstOrThrow({
      where: { event: "duplicate_identity_rejected" },
    });
    expect(JSON.stringify(audit)).not.toContain(email);
    expect(JSON.stringify(audit)).not.toContain("duplicate-rejected");
  });

  test("checks the current exact materials permission from Platform storage", async () => {
    const proof = verifiedAccountSignIn({
      issuer,
      subject: "materials-owner",
      verifiedEmail: "owner@example.test",
    });
    const established = await accounts.establishAccount({ identity: proof.identity });
    expect(established.ok).toBe(true);
    if (!established.ok) return;
    const query = {
      accountId: established.account.accountId,
      permission: "materials:manage" as const,
    };
    await expect(accounts.checkPermission(query)).resolves.toEqual({
      ok: true,
      allowed: false,
    });
    await database.prisma.accountPermission.create({ data: query });
    await expect(accounts.checkPermission(query)).resolves.toEqual({
      ok: true,
      allowed: true,
    });
    await database.prisma.accountPermission.delete({
      where: { accountId_permission: query },
    });
    await expect(accounts.checkPermission(query)).resolves.toEqual({
      ok: true,
      allowed: false,
    });
  });

  test("bootstraps the owner Account and grant idempotently without email", async () => {
    const identity = { issuer, subject: "release-owner" };
    const first = await bootstrapOwnerAccount(database.prisma, identity);
    const second = await bootstrapOwnerAccount(database.prisma, identity);

    expect(first).toMatchObject({
      accountCreated: true,
      permissionGranted: true,
    });
    expect(second).toEqual({
      accountId: first.accountId,
      accountCreated: false,
      permissionGranted: false,
    });
    await expect(
      database.prisma.account.findUniqueOrThrow({
        where: { id: first.accountId },
        select: { emailFingerprint: true },
      }),
    ).resolves.toEqual({ emailFingerprint: null });
  });
});
