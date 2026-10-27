import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { backfillBillingContactFingerprints } from "../../src/modules/accounts/index.js";
import { BillingContact } from "../../src/modules/accounts/facets/billing-contact/billing-contact.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { fingerprintEmail } from "../../src/modules/accounts/shared/account-input.js";
import type { AccountsPrismaClient } from "../../src/infrastructure/prisma/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const protection = billingContactProtection(encryptionKey);
const emailFingerprintKey = "billing-fingerprint-backfill-test-key-00";
const fingerprintOf = (email: string) =>
  fingerprintEmail(email, emailFingerprintKey);
const verifiedAt = new Date("2026-10-01T09:00:00Z");

describe("Billing Contact fingerprint backfill (real PostgreSQL, synthetic email)", () => {
  let database: TestDatabase;
  beforeEach(async () => {
    database = await createMigratedTestDatabase();
  });
  afterEach(async () => database.dispose());

  async function account() {
    const id = randomUUID();
    await database.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://example.test/oidc",
        logtoSubject: id,
      },
    });
    return id;
  }
  /** A contact verified before 0114, or by a release that does not write the fingerprint. */
  async function legacyContact(email: string, revision = 1) {
    const accountId = await account();
    await database.prisma.billingContact.create({
      data: {
        accountId,
        revision,
        emailCiphertext: protection.seal(accountId, email),
        verifiedAt,
      },
    });
    return accountId;
  }
  const backfill = (
    prisma: AccountsPrismaClient = database.prisma,
    pageSize?: number,
  ) =>
    backfillBillingContactFingerprints({
      prisma,
      encryptionKey,
      emailFingerprintKey,
      ...(pageSize === undefined ? {} : { pageSize }),
    });
  const row = (accountId: string) =>
    database.prisma.billingContact.findUniqueOrThrow({ where: { accountId } });

  test("fills every verified contact across pages and a rerun writes nothing", async () => {
    const emails = Array.from(
      { length: 5 },
      (_, index) => `Legacy-${String(index)}@Example.Test`,
    );
    const verified = [];
    for (const email of emails) verified.push(await legacyContact(email));
    const pending = await account();
    await database.prisma.billingContact.create({
      data: { accountId: pending, challengeRef: randomUUID() },
    });

    expect(await backfill(database.prisma, 2)).toEqual({
      scanned: 5,
      written: 5,
      skippedConcurrent: 0,
      unreadable: 0,
    });
    for (const [index, accountId] of verified.entries()) {
      expect(await row(accountId)).toMatchObject({
        revision: 1,
        emailFingerprint: fingerprintOf(emails[index] ?? ""),
        emailFingerprintRevision: 1,
      });
    }
    expect(await row(pending)).toMatchObject({
      emailFingerprint: null,
      emailFingerprintRevision: null,
    });
    expect(await backfill(database.prisma, 2)).toEqual({
      scanned: 0,
      written: 0,
      skippedConcurrent: 0,
      unreadable: 0,
    });
  });

  test("repairs a fingerprint left behind by a confirm that did not write one", async () => {
    const accountId = await legacyContact("current@example.test", 2);
    await database.prisma.billingContact.update({
      where: { accountId },
      data: {
        emailFingerprint: fingerprintOf("previous@example.test") ?? null,
        emailFingerprintRevision: 1,
      },
    });
    const current = await legacyContact("current@example.test");
    await database.prisma.billingContact.update({
      where: { accountId: current },
      data: {
        emailFingerprint: fingerprintOf("current@example.test") ?? null,
        emailFingerprintRevision: 1,
      },
    });

    expect(await backfill()).toEqual({
      scanned: 1,
      written: 1,
      skippedConcurrent: 0,
      unreadable: 0,
    });
    expect(await row(accountId)).toMatchObject({
      revision: 2,
      emailFingerprint: fingerprintOf("current@example.test"),
      emailFingerprintRevision: 2,
    });
  });

  test("a confirm that commits between the read and the write wins", async () => {
    const owner = await legacyContact("before-race@example.test");
    const codes = new Map<string, string>();
    const instant = new Date("2026-10-27T10:00:00Z");
    const contact = new BillingContact({
      prisma: database.prisma,
      protection,
      emailFingerprintKey,
      sendCode: (message) => {
        codes.set(message.challengeRef, message.code);
        return Promise.resolve();
      },
      documents: [],
      now: () => instant,
    });
    const started = await contact.start(owner, {
      operationId: randomUUID(),
      email: "after-race@example.test",
      expectedRevision: 1,
    });
    if (!started.ok) throw new Error(started.error.code);
    let raced = false;
    // A confirm commits after the backfill read the row and before its conditional write.
    const billingContacts = new Proxy(database.prisma.billingContact, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (property !== "updateMany" || typeof value !== "function")
          return value;
        return async (...input: readonly unknown[]): Promise<unknown> => {
          if (!raced) {
            raced = true;
            expect(
              await contact.confirm(owner, {
                operationId: randomUUID(),
                challengeRef: started.challengeRef,
                code: codes.get(started.challengeRef) ?? "",
              }),
            ).toEqual({ ok: true, revision: 2 });
          }
          return Reflect.apply(value, target, input);
        };
      },
    });
    const racing = new Proxy(database.prisma, {
      get(target, property) {
        if (property === "billingContact") return billingContacts;
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...input: readonly unknown[]): unknown =>
          Reflect.apply(value, target, input);
      },
    });

    expect(await backfill(racing)).toEqual({
      scanned: 1,
      written: 0,
      skippedConcurrent: 1,
      unreadable: 0,
    });
    expect(raced).toBe(true);
    expect(await row(owner)).toMatchObject({
      revision: 2,
      emailFingerprint: fingerprintOf("after-race@example.test"),
      emailFingerprintRevision: 2,
    });
    expect((await backfill()).scanned).toBe(0);
  });

  test("counts unreadable contacts, keeps going and never prints an address", async () => {
    const readable = await legacyContact("opened-address@example.test");
    const foreign = await account();
    await database.prisma.billingContact.create({
      data: {
        accountId: foreign,
        revision: 1,
        // Sealed for another Account: authenticated decryption rejects it.
        emailCiphertext: protection.seal(
          readable,
          "sealed-elsewhere@example.test",
        ),
        verifiedAt,
      },
    });
    const malformed = await legacyContact("not-an-address");
    const output: string[] = [];
    const capture = (...values: unknown[]) => {
      output.push(values.map(String).join(" "));
    };
    const spies = [
      vi.spyOn(console, "log").mockImplementation(capture),
      vi.spyOn(console, "info").mockImplementation(capture),
      vi.spyOn(console, "warn").mockImplementation(capture),
      vi.spyOn(console, "error").mockImplementation(capture),
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      }),
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      }),
    ];
    let result;
    try {
      result = await backfill();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(result).toEqual({
      scanned: 3,
      written: 1,
      skippedConcurrent: 0,
      unreadable: 2,
    });
    const printed = [...output, JSON.stringify(result)].join("\n");
    for (const address of [
      "opened-address",
      "sealed-elsewhere",
      "not-an-address",
      "example.test",
    ])
      expect(printed).not.toContain(address);
    for (const accountId of [foreign, malformed])
      expect(await row(accountId)).toMatchObject({
        emailFingerprint: null,
        emailFingerprintRevision: null,
      });
    expect((await row(readable)).emailFingerprintRevision).toBe(1);
    expect(await backfill()).toEqual({
      scanned: 2,
      written: 0,
      skippedConcurrent: 0,
      unreadable: 2,
    });
  });

  test("the schema keeps a fingerprint and its revision together", async () => {
    const accountId = await legacyContact("paired@example.test");
    await expect(
      database.prisma.billingContact.update({
        where: { accountId },
        data: {
          emailFingerprint: fingerprintOf("paired@example.test") ?? null,
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingContact.update({
        where: { accountId },
        data: { emailFingerprintRevision: 1 },
      }),
    ).rejects.toThrow();
  });
});
