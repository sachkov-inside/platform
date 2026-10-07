import { createHash, randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { verifiedTelegramAccountSignIn } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import {
  TelegramAccountSignIn,
  type TelegramSignInProvider,
} from "../../src/modules/telegram-membership/features/complete-telegram-sign-in/telegram-account-sign-in.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { hasText } from "../../src/infrastructure/contracts/text.js";
import {
  ACCOUNTS,
  LegalAcceptances,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../src/modules/accounts/index.js";
import { ResumeTelegramAccountSignInController } from "../../src/modules/telegram-membership/features/complete-telegram-sign-in/resume-telegram-account-sign-in.controller.js";
import { declaredServer } from "../support/declared-api.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { assembleTelegramMembership } from "../../src/modules/telegram-membership/index.js";

let database: TestDatabase;
let terms: LegalAcceptances;
const termsText = "Synthetic terms of use 883, not legal terms";
const termsEdition = {
  documentId: "terms" as const,
  version: "test-883",
  text: termsText,
  digest: createHash("sha256").update(termsText).digest("hex"),
  url: "https://inside.example.test/legal/terms/test-883",
};
function termsJournal(prisma: TestDatabase["prisma"]) {
  return new LegalAcceptances({
    prisma,
    terms: termsEdition,
    now: () => new Date(),
  });
}
async function acceptTerms(journal: LegalAcceptances, accountId: string) {
  await expect(
    journal.acceptTerms(accountId, {
      operationId: randomUUID(),
      version: termsEdition.version,
      digest: termsEdition.digest,
      buttonLabel: "Принять условия и продолжить",
    }),
  ).resolves.toMatchObject({ ok: true });
}
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  terms = termsJournal(database.prisma);
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
  });
  const signIn = new TelegramAccountSignIn({
    terms,
    accounts,
    prisma: database.prisma,
    provider,
    membershipEntitlements,
  });
  const first = proof("telegram-timeout");
  const established = await accounts.establishAccount({
    identity: first.identity,
  });
  if (!established.ok) throw new Error(established.error.code);
  await acceptTerms(terms, established.account.accountId);
  await expect(signIn.complete(first.identity)).resolves.toEqual({
    ok: false,
    error: { code: "unavailable" },
  });
  const principalRef = principals[0];
  if (!hasText(principalRef) || !first.identity.telegram)
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
  await database.prisma.telegramLinkTransaction.update({
    where: { principalRef },
    data: {
      createdAt: new Date(Date.now() - 301000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
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

test("a Telegram sign-in completes the bot link only after the terms of use are accepted", async () => {
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: fingerprintKey,
  });
  const telegramIdentityRef = randomUUID();
  const bound: string[] = [];
  const provider: TelegramSignInProvider = {
    bindAccount(_requestRef, _subjectRef, principalRef) {
      bound.push(principalRef);
      return Promise.resolve({ status: "linked", telegramIdentityRef });
    },
  };

  const signIn = new TelegramAccountSignIn({
    terms,
    accounts,
    prisma: database.prisma,
    provider,
    membershipEntitlements: assembleMembershipEntitlements({
      prisma: database.prisma,
    }),
  });
  const signedIn = proof("telegram-before-terms");
  const first = await signIn.complete(signedIn.identity);
  if (!first.ok) throw new Error(first.error.code);
  const pending =
    await database.prisma.telegramLinkTransaction.findFirstOrThrow({
      where: { accountId: first.account.accountId },
    });
  expect(pending.status).not.toBe("linked");
  expect(pending.providerIdentityRef).toBe(telegramIdentityRef);
  expect(pending.providerTransactionRef).toBe(
    signedIn.identity.telegram?.requestRef,
  );
  expect(
    await database.prisma.membershipBinding.count({
      where: { accountId: first.account.accountId },
    }),
  ).toBe(0);
  await expect(signIn.resume(first.account)).resolves.toMatchObject({
    ok: false,
    error: { code: "unavailable" },
  });
  // The bot keeps recognising the person, so leaving before the screen does not strand the identity.
  await expect(
    signIn.resolveLink(
      pending.principalRef,
      telegramIdentityRef,
      signedIn.identity.telegram?.subjectRef ?? "",
    ),
  ).resolves.toEqual({ issuer, subject: "telegram-before-terms" });

  await acceptTerms(terms, first.account.accountId);
  await database.prisma.telegramLinkTransaction.update({
    where: { linkRef: pending.linkRef },
    data: {
      createdAt: new Date(Date.now() - 301000),
      expiresAt: new Date(Date.now() - 1000),
      status: "expired",
      // v10 left this field empty; the verified original request is still linkRef.
      providerTransactionRef: null,
    },
  });
  const failedRetry = await database.prisma.telegramLinkTransaction.create({
    data: {
      linkRef: randomUUID(),
      accountId: first.account.accountId,
      principalRef: randomUUID(),
      returnCorrelation: randomUUID(),
      tokenDigest: randomUUID(),
      status: "recovery_required",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 300000),
    },
  });
  const membership = assembleTelegramMembership({
    prisma: database.prisma,
    membershipEntitlements: assembleMembershipEntitlements({
      prisma: database.prisma,
    }),
    botStartUrl: "https://t.me/inside_test_bot",
    linkLifetimeMs: 300000,
    provider: {
      register: () => {
        throw new Error(
          "A confirmed sign-in must not register a new principal",
        );
      },
      confirm: () => {
        throw new Error("Not part of this scenario");
      },
    },
  });
  await expect(
    membership.beginLink({ accountId: accountId(first.account.accountId) }),
  ).resolves.toMatchObject({
    ok: true,
    state: { linkRef: pending.linkRef, status: "unavailable" },
  });
  // Audience refresh no longer carries the authorization_code-only Telegram claim.
  const completed = await signIn.resume(first.account);
  expect(completed).toEqual(first);
  const linked =
    await database.prisma.telegramLinkTransaction.findUniqueOrThrow({
      where: { linkRef: pending.linkRef },
    });
  expect(linked).toMatchObject({ linkRef: pending.linkRef, status: "linked" });
  expect(new Set(bound)).toEqual(new Set([pending.principalRef]));
  await expect(signIn.resume(first.account)).resolves.toEqual(first);
  await expect(
    membership.readAccountPresentation({
      accountId: accountId(first.account.accountId),
    }),
  ).resolves.toMatchObject({
    ok: true,
    presentation: { link: { kind: "linked" } },
  });
  expect(
    await database.prisma.telegramLinkTransaction.findUnique({
      where: { linkRef: failedRetry.linkRef },
    }),
  ).toMatchObject({ status: "recovery_required" });
});

test.each(["identity", "correlation"] as const)(
  "a deferred %s mismatch never publishes another provider identity or principal",
  async (mismatch) => {
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: fingerprintKey,
    });

    let telegramIdentityRef = randomUUID();
    const signIn = new TelegramAccountSignIn({
      accounts,
      prisma: database.prisma,
      terms,
      provider: {
        bindAccount: () =>
          Promise.resolve({ status: "linked" as const, telegramIdentityRef }),
      },
      membershipEntitlements: assembleMembershipEntitlements({
        prisma: database.prisma,
      }),
    });
    const first = await signIn.complete(
      proof(`telegram-receipt-mismatch-${mismatch}`).identity,
    );
    if (!first.ok) throw new Error(first.error.code);
    await acceptTerms(terms, first.account.accountId);
    if (mismatch === "identity") telegramIdentityRef = randomUUID();
    else {
      await database.prisma.telegramLinkTransaction.updateMany({
        where: { accountId: first.account.accountId },
        data: { returnCorrelation: randomUUID() },
      });
    }
    await expect(signIn.resume(first.account)).resolves.toEqual({
      ok: false,
      error: { code: "identity_conflict" },
    });
    expect(
      await database.prisma.membershipBinding.count({
        where: { accountId: first.account.accountId },
      }),
    ).toBe(0);
    expect(
      await database.prisma.telegramLinkTransaction.findFirst({
        where: { accountId: first.account.accountId },
      }),
    ).toMatchObject({ status: "registering" });
  },
);

test.each([
  "linked",
  "unavailable",
  "identity-mismatch",
  "correlation-mismatch",
] as const)(
  "confirm resumes an expired v10 receipt safely when the provider reports %s",
  async (outcome) => {
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: fingerprintKey,
    });
    const membershipEntitlements = assembleMembershipEntitlements({
      prisma: database.prisma,
    });
    const telegramIdentityRef = randomUUID();
    const signIn = new TelegramAccountSignIn({
      accounts,
      prisma: database.prisma,
      membershipEntitlements,
      terms,
      provider: {
        bindAccount: () =>
          Promise.resolve({ status: "linked" as const, telegramIdentityRef }),
      },
    });
    const signedIn = proof(`telegram-confirm-${outcome}`);
    const first = await signIn.complete(signedIn.identity);
    if (!first.ok) throw new Error(first.error.code);
    const receipt =
      await database.prisma.telegramLinkTransaction.findFirstOrThrow({
        where: { accountId: first.account.accountId },
      });
    await database.prisma.telegramLinkTransaction.update({
      where: { linkRef: receipt.linkRef },
      data: {
        createdAt: new Date(Date.now() - 301000),
        expiresAt: new Date(Date.now() - 1000),
        status: "expired",
        providerTransactionRef: null,
      },
    });
    let currentOutcome = outcome;
    const membership = assembleTelegramMembership({
      prisma: database.prisma,
      membershipEntitlements,
      botStartUrl: "https://t.me/inside_test_bot",
      linkLifetimeMs: 300000,
      provider: {
        register: () => {
          throw new Error("Must retain the confirmed principal");
        },
        confirm: (request) => {
          expect(request).toEqual({
            accountRef: receipt.principalRef,
            linkTransactionRef: receipt.linkRef,
            returnCorrelation: receipt.returnCorrelation,
          });
          return Promise.resolve(
            currentOutcome === "unavailable"
              ? { kind: "unavailable" as const }
              : {
                  kind: "linked" as const,
                  linkTransactionRef: receipt.linkRef,
                  returnCorrelation:
                    currentOutcome === "correlation-mismatch"
                      ? randomUUID()
                      : receipt.returnCorrelation,
                  telegramIdentityRef:
                    currentOutcome === "identity-mismatch"
                      ? randomUUID()
                      : telegramIdentityRef,
                },
          );
        },
      },
    });
    const command = {
      accountId: accountId(first.account.accountId),
      linkRef: receipt.linkRef,
    };
    await acceptTerms(terms, first.account.accountId);
    await expect(membership.confirmLink(command)).resolves.toMatchObject({
      ok: true,
      state: {
        status: outcome.includes("mismatch") ? "recovery-required" : outcome,
      },
    });
    if (outcome === "unavailable") {
      await expect(
        membership.beginLink({ accountId: command.accountId }),
      ).resolves.toMatchObject({
        ok: true,
        state: { linkRef: receipt.linkRef, status: "unavailable" },
      });
      currentOutcome = "linked";
      await expect(membership.confirmLink(command)).resolves.toMatchObject({
        ok: true,
        state: { status: "linked" },
      });
    }
    expect(
      await database.prisma.membershipBinding.count({
        where: { accountId: first.account.accountId },
      }),
    ).toBe(outcome.includes("mismatch") ? 0 : 1);
    expect(
      await database.prisma.telegramLinkTransaction.findUnique({
        where: { linkRef: receipt.linkRef },
      }),
    ).toMatchObject({
      principalRef: receipt.principalRef,
      providerIdentityRef: telegramIdentityRef,
    });
  },
);

test("current-account resume uses normal identity authentication and refuses before terms", async () => {
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: fingerprintKey,
  });
  const signedIn = proof("telegram-resume-http");

  const signIn = new TelegramAccountSignIn({
    accounts,
    prisma: database.prisma,
    terms,
    provider: {
      bindAccount: () =>
        Promise.resolve({
          status: "linked" as const,
          telegramIdentityRef: "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11",
        }),
    },
    membershipEntitlements: assembleMembershipEntitlements({
      prisma: database.prisma,
    }),
  });
  const first = await signIn.complete(signedIn.identity);
  if (!first.ok) throw new Error(first.error.code);
  @Module({
    controllers: [ResumeTelegramAccountSignInController],
    providers: [
      { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
      { provide: TelegramAccountSignIn, useValue: signIn },
      { provide: ACCOUNTS, useValue: accounts },
      { provide: LegalAcceptances, useValue: terms },
      {
        provide: LOGTO_ACCESS_TOKEN_VERIFIER,
        useValue: {
          verifyAccount: (credential: string | undefined) =>
            Promise.resolve(
              credential === "refreshed-access-token"
                ? { ok: true, identity: signedIn.accountIdentity }
                : { ok: false, error: { code: "invalid_proof" } },
            ),
        },
      },
    ],
  })
  // oxlint-disable-next-line typescript/no-extraneous-class -- Nest owns the isolated HTTP fixture metadata.
  class ResumeFixture {}
  const app = await NestFactory.create<NestFastifyApplication>(
    ResumeFixture,
    new FastifyAdapter(),
    { logger: false },
  );
  try {
    await app.init();
    const http = declaredServer(app.getHttpAdapter().getInstance());
    await http.ready();
    const request = {
      method: "POST" as const,
      url: "/accounts/current/telegram-sign-in/resume",
    };
    expect((await http.inject(request)).statusCode).toBe(401);
    const authenticated = {
      ...request,
      headers: { authorization: "Bearer refreshed-access-token" },
    };
    expect((await http.inject(authenticated)).statusCode).toBe(403);
    await acceptTerms(terms, first.account.accountId);
    const response = await http.inject({
      ...authenticated,
      payload: { accountId: randomUUID(), principalRef: randomUUID() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ account: first.account });
    expect(response.headers["cache-control"]).toContain("no-store");
  } finally {
    await app.close();
  }
});

test.each(["resume", "confirm"] as const)(
  "a failed %s finalize rolls back the principal binding and uses no second pooled connection",
  async (operation) => {
    const rollbackDatabase = await createMigratedTestDatabase();
    try {
      await withExhaustedPool(rollbackDatabase, async (prisma) => {
        const journal = termsJournal(prisma);
        const membershipEntitlements = assembleMembershipEntitlements({
          prisma,
        });
        const signIn = new TelegramAccountSignIn({
          prisma,
          terms: journal,
          accounts: assembleAccounts({
            prisma,
            emailFingerprintKey: fingerprintKey,
          }),
          membershipEntitlements,
          provider: {
            bindAccount: () =>
              Promise.resolve({
                status: "linked" as const,
                telegramIdentityRef: "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11",
              }),
          },
        });
        const first = await signIn.complete(
          proof("telegram-finalize-rollback").identity,
        );
        if (!first.ok) throw new Error(first.error.code);
        const receipt = await prisma.telegramLinkTransaction.findFirstOrThrow({
          where: { accountId: first.account.accountId },
        });
        const providerIdentityRef = receipt.providerIdentityRef;
        const providerTransactionRef = receipt.providerTransactionRef;
        if (providerIdentityRef === null || providerTransactionRef === null)
          throw new Error("Missing confirmed provider receipt");
        const membership = assembleTelegramMembership({
          prisma,
          membershipEntitlements,
          botStartUrl: "https://t.me/inside_test_bot",
          linkLifetimeMs: 300000,
          provider: {
            register: () => {
              throw new Error("Must retain the confirmed principal");
            },
            confirm: () =>
              Promise.resolve({
                kind: "linked" as const,
                telegramIdentityRef: providerIdentityRef,
                linkTransactionRef: providerTransactionRef,
                returnCorrelation: receipt.returnCorrelation,
              }),
          },
        });
        const finalize = () =>
          operation === "resume"
            ? signIn.resume(first.account)
            : membership.confirmLink({
                accountId: accountId(first.account.accountId),
                linkRef: receipt.linkRef,
              });
        await acceptTerms(journal, first.account.accountId);
        await prisma.$executeRaw(Prisma.sql`
        create function telegram_membership.reject_test_finalize() returns trigger language plpgsql as $$
        begin
          if new.status = 'linked' then raise exception 'synthetic journal failure'; end if;
          return new;
        end $$
      `);
        await prisma.$executeRaw(Prisma.sql`
        create trigger reject_test_finalize before update on telegram_membership.link_transactions
        for each row execute function telegram_membership.reject_test_finalize()
      `);
        await expect(finalize()).resolves.toEqual({
          ok: false,
          error: { code: "unavailable" },
        });
        expect(
          await prisma.membershipBinding.count({
            where: { accountId: first.account.accountId },
          }),
        ).toBe(0);
        await prisma.$executeRaw(
          Prisma.sql`drop trigger reject_test_finalize on telegram_membership.link_transactions`,
        );
        await expect(finalize()).resolves.toMatchObject({ ok: true });
        expect(
          await prisma.membershipBinding.count({
            where: { accountId: first.account.accountId },
          }),
        ).toBe(1);
      });
    } finally {
      await rollbackDatabase.dispose();
    }
  },
);
