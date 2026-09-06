import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { verifiedTelegramAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import {
  TelegramAccountSignIn,
  type TelegramSignInProvider,
} from "../../src/modules/telegram-membership/features/complete-telegram-sign-in/telegram-account-sign-in.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => database.dispose());
const issuer = "https://identity.example.test/oidc";
const fingerprintKey = "telegram-sign-in-test-fingerprint-key";
const proof = (subject: string, subjectRef: string = randomUUID()) =>
  verifiedTelegramAccountSignIn({
    issuer,
    subject,
    telegram: { subjectRef, requestRef: randomUUID() },
  });

test("concurrent first Telegram sign-ins converge without email or permissions; another Logto subject cannot claim the identity", async () => {
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: fingerprintKey,
  });
  const identity = proof("telegram-concurrent").identity;
  const results = await Promise.all(
    Array.from({ length: 8 }, () => accounts.establishAccount({ identity })),
  );
  expect(results.every((result) => result.ok)).toBe(true);
  expect(
    new Set(
      results.map((result) =>
        result.ok ? result.account.accountId : "failed",
      ),
    ).size,
  ).toBe(1);
  const row = await database.prisma.account.findUniqueOrThrow({
    where: {
      logtoIssuer_logtoSubject: {
        logtoIssuer: issuer,
        logtoSubject: "telegram-concurrent",
      },
    },
  });
  expect(row.emailFingerprint).toBeNull();
  expect(
    await database.prisma.accountPermission.count({
      where: { accountId: row.id },
    }),
  ).toBe(0);
  const stolen = proof("another-logto-subject", identity.telegram?.subjectRef);
  await expect(
    accounts.establishAccount({ identity: stolen.identity }),
  ).resolves.toEqual({ ok: false, error: { code: "identity_conflict" } });
});

test("a lost provider response retains one Account and principal, and a fresh proof repairs the incomplete link", async () => {
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: fingerprintKey,
  });
  const principals: string[] = [];
  const telegramIdentityRef = randomUUID();
  let unavailable = true;
  const provider: TelegramSignInProvider = {
    bindAccount(_requestRef, _subjectRef, principalRef) {
      principals.push(principalRef);
      return Promise.resolve(
        unavailable
          ? { status: "unavailable" }
          : { status: "linked", telegramIdentityRef },
      );
    },
  };
  const membershipEntitlements = assembleMembershipEntitlements({
    prisma: database.prisma,
    workshopEntitlements: assembleWorkshopEntitlements({
      prisma: database.prisma,
    }),
  });
  const signIn = new TelegramAccountSignIn({
    accounts,
    prisma: database.prisma,
    provider,
    membershipEntitlements,
  });
  const first = proof("telegram-timeout");
  await expect(signIn.complete(first.identity)).resolves.toEqual({
    ok: false,
    error: { code: "unavailable" },
  });
  const principalRef = principals[0];
  if (!principalRef || !first.identity.telegram)
    throw new Error("Expected a retained principal");
  await expect(
    signIn.resolveLink(
      principalRef,
      telegramIdentityRef,
      first.identity.telegram.subjectRef,
    ),
  ).resolves.toEqual({ issuer, subject: "telegram-timeout" });
  await expect(
    signIn.resolveLink(principalRef, telegramIdentityRef, randomUUID()),
  ).resolves.toBeUndefined();
  unavailable = false;
  const retry = await signIn.complete(
    proof("telegram-timeout", first.identity.telegram.subjectRef).identity,
  );
  expect(retry.ok).toBe(true);
  expect(new Set(principals).size).toBe(1);
  if (!retry.ok) throw new Error("Expected repaired sign-in");
  expect(
    await database.prisma.telegramLinkTransaction.count({
      where: { accountId: retry.account.accountId },
    }),
  ).toBe(1);
  const row = await database.prisma.telegramLinkTransaction.findFirstOrThrow({
    where: { accountId: retry.account.accountId },
  });
  expect(row.status).toBe("linked");
  expect(
    await database.prisma.accountPermission.count({
      where: { accountId: retry.account.accountId },
    }),
  ).toBe(0);
});
