import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import type { LoginEmailNativeAuthority } from "../../src/modules/accounts/facets/login-email-identity/login-email-native-authority.js";
import {
  verifiedAccountSignIn,
  verifiedTelegramAccountSignIn,
} from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import type { NativeLoginEmailCommit } from "../../src/modules/accounts/features/login-email-identity/login-email-policy.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const key = "461-login-email-fingerprint-test-key";

/** Real PG corpus; the native authority is an EXTERNAL boundary fixture, not Logto runtime proof. */
describe("Accounts first-email operation ledger", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
  });
  afterAll(async () => {
    await database.dispose();
  });

  async function owner(email: string) {
    const subject = randomUUID();
    const telegram = { subjectRef: randomUUID(), requestRef: randomUUID() };
    const signIn = verifiedTelegramAccountSignIn({ issuer, subject, telegram });
    let clock = new Date("2026-10-10T03:00:00.000Z");
    let selectedEmail = email;
    let verificationRef = randomUUID();
    let committed: NativeLoginEmailCommit | undefined;
    let browserBindingDigest = "a".repeat(64);
    const interaction = {
      ownerIdentity: { issuer, subject },
      interactionRef: randomUUID(),
      browserBindingDigest,
    };
    const authority: LoginEmailNativeAuthority = {
      readInteraction() {
        return Promise.resolve({ ...interaction, browserBindingDigest });
      },
      readVerifiedCandidate(command) {
        return Promise.resolve({
          ...interaction,
          browserBindingDigest,
          intentRef: command.intentRef,
          email: selectedEmail,
          verificationRef,
          telegramProof: { ...telegram, approvedAt: clock.toISOString() },
        });
      },
      readCommittedEmail() {
        return Promise.resolve(committed);
      },
    };
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: key,
      loginEmailNativeAuthority: authority,
      now: () => clock,
    });
    const established = await accounts.establishAccount({
      identity: signIn.identity,
    });
    if (!established.ok) throw new Error("Fixture Account was not established");
    const accountId = established.account.accountId;
    const begin = await accounts.loginEmailIdentity.begin({
      identity: signIn.accountIdentity,
      commandRef: randomUUID(),
      nativeContext: undefined,
    });
    if (!("intentRef" in begin))
      throw new Error("Fixture intent was not begun");
    const command = {
      identity: signIn.accountIdentity,
      intentRef: begin.intentRef,
      nativeContext: undefined,
    };
    await expect(
      accounts.loginEmailIdentity.selectCandidate(command),
    ).resolves.toMatchObject({ status: "pending" });
    return {
      accounts,
      command,
      accountId,
      signIn,
      begin,
      interaction,
      email,
      expire() {
        clock = new Date(clock.getTime() + 11 * 60_000);
      },
      selectOther(value: string) {
        selectedEmail = value;
        verificationRef = randomUUID();
      },
      wrongBrowser() {
        browserBindingDigest = "b".repeat(64);
      },
      commit(overrides: Partial<NativeLoginEmailCommit> = {}) {
        committed = {
          ...interaction,
          intentRef: command.intentRef,
          state: "attached",
          email: selectedEmail,
          verificationRef,
          ...overrides,
        };
      },
    };
  }

  it("retains an unknown reservation past TTL, rejects email sign-in bypass, reconciles the same Account and preserves rights", async () => {
    const fixture = await owner(`first-${randomUUID()}@example.test`);
    await database.prisma.accountPermission.create({
      data: { accountId: fixture.accountId, permission: "materials:manage" },
    });
    const before = await database.prisma.account.findUniqueOrThrow({
      where: { id: fixture.accountId },
    });
    await expect(
      fixture.accounts.loginEmailIdentity.reserve(fixture.command),
    ).resolves.toMatchObject({ status: "reserved" });
    await expect(
      fixture.accounts.loginEmailIdentity.finalize(fixture.command),
    ).resolves.toMatchObject({ status: "reconciliation_required" });
    fixture.expire();
    const contender = verifiedAccountSignIn({
      issuer,
      subject: randomUUID(),
      verifiedEmail: fixture.email.toUpperCase(),
    });
    await expect(
      fixture.accounts.establishAccount({ identity: contender.identity }),
    ).resolves.toEqual({ ok: false, error: { code: "identity_conflict" } });
    await expect(
      fixture.accounts.loginEmailIdentity.reconcile({
        ...fixture.command,
        intentRef: randomUUID(),
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    fixture.commit();
    await expect(
      fixture.accounts.loginEmailIdentity.reconcile(fixture.command),
    ).resolves.toMatchObject({
      status: "finalized",
      intentRef: fixture.command.intentRef,
    });
    await expect(
      fixture.accounts.loginEmailIdentity.finalize(fixture.command),
    ).resolves.toMatchObject({ status: "finalized" });
    const after = await database.prisma.account.findUniqueOrThrow({
      where: { id: fixture.accountId },
    });
    expect({ ...after, emailFingerprint: null }).toEqual(before);
    expect(after.emailFingerprint).not.toBeNull();
    await expect(
      fixture.accounts.checkPermission({
        accountId: fixture.accountId,
        permission: "materials:manage",
      }),
    ).resolves.toEqual({ ok: true, allowed: true });
    await expect(
      fixture.accounts.checkPermission({
        accountId: fixture.accountId,
        permission: "platform:admin",
      }),
    ).resolves.toEqual({ ok: true, allowed: false });
    await expect(
      fixture.accounts.establishAccount({
        identity: verifiedAccountSignIn({
          issuer,
          subject: fixture.signIn.identity.subject,
          verifiedEmail: fixture.email,
        }).identity,
      }),
    ).resolves.toEqual({ ok: true, account: { accountId: fixture.accountId } });
  });

  it("serializes two owners reserving normalized equivalents and blocks ordinary sign-in until authoritative finalization", async () => {
    const email = `race-${randomUUID()}@example.test`;
    const [first, second] = await Promise.all([
      owner(email),
      owner(email.toUpperCase()),
    ]);
    const reservations = await Promise.all([
      first.accounts.loginEmailIdentity.reserve(first.command),
      second.accounts.loginEmailIdentity.reserve(second.command),
    ]);
    expect(reservations.map((r) => r.status).sort()).toEqual([
      "identity_conflict",
      "reserved",
    ]);
    const outsider = verifiedAccountSignIn({
      issuer,
      subject: randomUUID(),
      verifiedEmail: email,
    });
    await expect(
      first.accounts.establishAccount({ identity: outsider.identity }),
    ).resolves.toEqual({ ok: false, error: { code: "identity_conflict" } });
    const winner = reservations[0].status === "reserved" ? first : second;
    const sameOwnerEmail = verifiedAccountSignIn({
      issuer,
      subject: winner.signIn.identity.subject,
      verifiedEmail: email,
    });
    await expect(
      winner.accounts.establishAccount({ identity: sameOwnerEmail.identity }),
    ).resolves.toEqual({ ok: false, error: { code: "identity_conflict" } });
    winner.commit();
    await expect(
      winner.accounts.loginEmailIdentity.finalize(winner.command),
    ).resolves.toMatchObject({ status: "finalized" });
    await expect(
      winner.accounts.establishAccount({ identity: sameOwnerEmail.identity }),
    ).resolves.toEqual({ ok: true, account: { accountId: winner.accountId } });
    await expect(
      first.accounts.establishAccount({ identity: outsider.identity }),
    ).resolves.toEqual({ ok: false, error: { code: "identity_conflict" } });
  });

  it("supersedes a changed unreserved candidate; old proof cannot reserve and unknown reserved intent cannot be replaced", async () => {
    const f = await owner(`old-${randomUUID()}@example.test`);
    f.selectOther(`new-${randomUUID()}@example.test`);
    await expect(
      f.accounts.loginEmailIdentity.selectCandidate(f.command),
    ).resolves.toMatchObject({ status: "superseded" });
    await expect(
      f.accounts.loginEmailIdentity.reserve(f.command),
    ).resolves.toMatchObject({ status: "superseded" });
    const reserved = await owner(`reserved-${randomUUID()}@example.test`);
    await reserved.accounts.loginEmailIdentity.reserve(reserved.command);
    reserved.expire();
    await expect(
      reserved.accounts.loginEmailIdentity.begin({
        identity: reserved.signIn.accountIdentity,
        commandRef: randomUUID(),
        nativeContext: undefined,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    reserved.selectOther(`changed-${randomUUID()}@example.test`);
    await expect(
      reserved.accounts.loginEmailIdentity.reserve(reserved.command),
    ).resolves.toMatchObject({ status: "reconciliation_required" });
  });

  it("rejects another browser binding and retains ownership on a wrong-subject or wrong-operation receipt", async () => {
    const f = await owner(`bound-${randomUUID()}@example.test`);
    f.wrongBrowser();
    await expect(
      f.accounts.loginEmailIdentity.reserve(f.command),
    ).resolves.toMatchObject({ status: "unavailable" });
    const r = await owner(`receipt-${randomUUID()}@example.test`);
    await r.accounts.loginEmailIdentity.reserve(r.command);
    r.commit({ ownerIdentity: { issuer, subject: randomUUID() } });
    await expect(
      r.accounts.loginEmailIdentity.finalize(r.command),
    ).resolves.toMatchObject({ status: "reconciliation_required" });
    r.commit({ intentRef: randomUUID() });
    await expect(
      r.accounts.loginEmailIdentity.reconcile(r.command),
    ).resolves.toMatchObject({ status: "reconciliation_required" });
    expect(
      (
        await database.prisma.account.findUniqueOrThrow({
          where: { id: r.accountId },
        })
      ).emailFingerprint,
    ).toBeNull();
    r.commit();
    await expect(
      r.accounts.loginEmailIdentity.reconcile(r.command),
    ).resolves.toMatchObject({ status: "finalized" });
  });

  it("keeps the original Telegram owner binding and cannot rebind a native interaction to a new command", async () => {
    const f = await owner(`original-${randomUUID()}@example.test`);
    await expect(
      f.accounts.loginEmailIdentity.begin({
        identity: f.signIn.accountIdentity,
        commandRef: randomUUID(),
        nativeContext: undefined,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    await f.accounts.loginEmailIdentity.reserve(f.command);
    f.commit();
    await database.prisma.account.update({
      where: { id: f.accountId },
      data: { telegramSubjectRef: randomUUID() },
    });
    await expect(
      f.accounts.loginEmailIdentity.finalize(f.command),
    ).resolves.toMatchObject({ status: "identity_conflict" });
    expect(
      (
        await database.prisma.account.findUniqueOrThrow({
          where: { id: f.accountId },
        })
      ).emailFingerprint,
    ).toBeNull();
    const ordinary = verifiedAccountSignIn({
      issuer,
      subject: randomUUID(),
      verifiedEmail: f.email,
    });
    await expect(
      f.accounts.establishAccount({ identity: ordinary.identity }),
    ).resolves.toEqual({ ok: false, error: { code: "identity_conflict" } });
  });

  it("fails closed without a native adapter and prevents direct terminal journal rewrites", async () => {
    const f = await owner(`immutable-${randomUUID()}@example.test`);
    const ordinary = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: key,
    });
    await expect(
      ordinary.loginEmailIdentity.reserve(f.command),
    ).resolves.toMatchObject({ status: "unavailable" });
    await f.accounts.loginEmailIdentity.reserve(f.command);
    f.commit();
    await f.accounts.loginEmailIdentity.finalize(f.command);
    await expect(
      database.prisma.$executeRaw(Prisma.sql`
      update accounts.login_email_intents set state = 'pending' where id = ${f.command.intentRef}::uuid
    `),
    ).rejects.toThrow();
    await expect(
      database.prisma.$executeRaw(Prisma.sql`
      delete from accounts.login_email_intents where id = ${f.command.intentRef}::uuid
    `),
    ).rejects.toThrow();
  });
});
