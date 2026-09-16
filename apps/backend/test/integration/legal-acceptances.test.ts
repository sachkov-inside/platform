import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { LegalAcceptances } from "../../src/modules/accounts/facets/legal-acceptances/legal-acceptances.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

function termsEdition(version: string) {
  const text = `Synthetic terms of use ${version}, not legal terms`;
  return {
    documentId: "terms" as const,
    version,
    digest: createHash("sha256").update(text).digest("hex"),
    url: `https://inside.example.test/legal/terms/v${version}`,
    text,
  };
}

const buttonLabel = "Принять условия и продолжить";

describe("Legal acceptance journal (real PostgreSQL)", () => {
  let database: TestDatabase;
  let instant = new Date("2026-09-15T09:04:00Z");
  let firstEdition: LegalAcceptances;
  let secondEdition: LegalAcceptances;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    firstEdition = new LegalAcceptances({
      prisma: database.prisma,
      terms: termsEdition("1"),
      now: () => instant,
    });
    secondEdition = new LegalAcceptances({
      prisma: database.prisma,
      terms: termsEdition("2"),
      now: () => instant,
    });
  });
  afterAll(async () => database.dispose());

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

  const accept = (
    journal: LegalAcceptances,
    accountId: string,
    edition: ReturnType<typeof termsEdition>,
    operationId: string = randomUUID(),
  ) =>
    journal.acceptTerms(accountId, {
      operationId,
      version: edition.version,
      digest: edition.digest,
      buttonLabel,
    });

  test("records the first sign-in acceptance of the terms in force without a verified contact", async () => {
    const accountId = await account();
    await expect(firstEdition.readTermsStatus(accountId)).resolves.toEqual({
      ok: true,
      accepted: false,
      previouslyAccepted: false,
      document: {
        documentId: "terms",
        version: "1",
        digest: termsEdition("1").digest,
        url: "https://inside.example.test/legal/terms/v1",
      },
    });
    await expect(firstEdition.checkTerms(accountId)).resolves.toEqual({
      ok: true,
      accepted: false,
    });

    const result = await accept(firstEdition, accountId, termsEdition("1"));
    if (!result.ok) throw new Error(result.error.code);

    const row = await database.prisma.legalAcceptance.findUniqueOrThrow({
      where: { id: result.acceptanceRef },
    });
    expect(row).toMatchObject({
      accountId,
      contextRef: null,
      kind: "terms",
      documentId: "terms",
      documentVersion: "1",
      documentDigest: termsEdition("1").digest,
      documentText: termsEdition("1").text,
      documentUrl: "https://inside.example.test/legal/terms/v1",
      screen: "first-sign-in",
      buttonLabel,
      shownTerms: null,
      acceptedAt: instant,
    });
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining(["ip", "userAgent"]),
    );
    expect(await database.prisma.billingContact.count({ where: { accountId } })).toBe(0);
    await expect(firstEdition.checkTerms(accountId)).resolves.toEqual({
      ok: true,
      accepted: true,
    });
  });

  test("answers a repeated operation from its row and refuses another payload under it", async () => {
    const accountId = await account();
    const operationId = randomUUID();
    const first = await accept(firstEdition, accountId, termsEdition("1"), operationId);
    const repeated = await accept(firstEdition, accountId, termsEdition("1"), operationId);
    expect(repeated).toEqual(first);
    await expect(
      firstEdition.acceptTerms(accountId, {
        operationId,
        version: "1",
        digest: termsEdition("1").digest,
        buttonLabel: "Другая кнопка",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "operation_conflict" } });
    // A second tab accepting the same edition reuses the journal row.
    const otherTab = await accept(firstEdition, accountId, termsEdition("1"));
    expect(otherTab).toEqual(first);
    expect(
      await database.prisma.legalAcceptance.count({ where: { accountId } }),
    ).toBe(1);
  });

  test("asks again when a new edition takes effect and refuses the superseded one", async () => {
    const accountId = await account();
    await accept(firstEdition, accountId, termsEdition("1"));
    await expect(secondEdition.readTermsStatus(accountId)).resolves.toMatchObject({
      ok: true,
      accepted: false,
      previouslyAccepted: true,
      document: { version: "2" },
    });
    await expect(secondEdition.checkTerms(accountId)).resolves.toEqual({
      ok: true,
      accepted: false,
    });
    await expect(
      accept(secondEdition, accountId, termsEdition("1")),
    ).resolves.toEqual({ ok: false, error: { code: "document_changed" } });
    instant = new Date(instant.getTime() + 60_000);
    const accepted = await accept(secondEdition, accountId, termsEdition("2"));
    expect(accepted.ok).toBe(true);
    await expect(secondEdition.checkTerms(accountId)).resolves.toEqual({
      ok: true,
      accepted: true,
    });
  });

  test("refuses input that names no account or no exact edition", async () => {
    const accountId = await account();
    await expect(
      firstEdition.acceptTerms(accountId, {
        operationId: randomUUID(),
        version: "1",
        digest: termsEdition("1").digest,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_input" } });
    await expect(
      accept(firstEdition, randomUUID(), termsEdition("1")),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
  });

  test("keeps journal rows immutable and refuses a row without screen and button", async () => {
    const accountId = await account();
    const result = await accept(firstEdition, accountId, termsEdition("1"));
    if (!result.ok) throw new Error(result.error.code);
    await expect(
      database.prisma.legalAcceptance.update({
        where: { id: result.acceptanceRef },
        data: { buttonLabel: "Переписано" },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.legalAcceptance.delete({ where: { id: result.acceptanceRef } }),
    ).rejects.toThrow();
    const edition = termsEdition("1");
    await expect(
      database.prisma.legalAcceptance.create({
        data: {
          id: randomUUID(),
          accountId,
          operationId: randomUUID(),
          contextRef: randomUUID(),
          kind: "terms",
          documentId: "purchase",
          documentVersion: "3",
          documentDigest: edition.digest,
          documentText: edition.text,
          documentUrl: edition.url,
          acceptedAt: instant,
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.legalAcceptance.create({
        data: {
          id: randomUUID(),
          accountId,
          operationId: randomUUID(),
          kind: "terms",
          documentId: "purchase",
          documentVersion: "3",
          documentDigest: edition.digest,
          documentText: edition.text,
          documentUrl: edition.url,
          screen: "checkout",
          buttonLabel: "Оплатить 2 500 ₽",
          acceptedAt: instant,
        },
      }),
    ).rejects.toThrow();
  });

  test("lists the owner's accepted documents newest first with button, screen and shown terms", async () => {
    const accountId = await account();
    const stranger = await account();
    const terms = await accept(firstEdition, accountId, termsEdition("1"));
    if (!terms.ok) throw new Error(terms.error.code);
    await accept(firstEdition, stranger, termsEdition("1"));
    const later = new Date(instant.getTime() + 3_600_000);
    const edition = termsEdition("1");
    const contextRef = randomUUID();
    const operationId = randomUUID();
    const shownTerms = {
      amountKopecks: 99_000,
      nextChargeOn: "2026-10-15",
      periodMonths: 1,
    };
    for (const [kind, documentId] of [
      ["terms", "subscription"],
      ["recurring", "recurring-consent"],
    ] as const)
      await database.prisma.legalAcceptance.create({
        data: {
          id: randomUUID(),
          accountId,
          operationId,
          contextRef,
          kind,
          documentId,
          documentVersion: "1",
          documentDigest: edition.digest,
          documentText: edition.text,
          documentUrl: `https://inside.example.test/legal/${documentId}/v1`,
          screen: "checkout",
          buttonLabel: "Оформить подписку и оплатить 990 ₽",
          shownTerms,
          acceptedAt: later,
        },
      });

    const listed = await firstEdition.listAccepted(accountId);
    if (!listed.ok) throw new Error(listed.error.code);
    expect(listed.documents).toHaveLength(3);
    expect(listed.documents.map((document) => document.documentId).toSorted()).toEqual([
      "recurring-consent",
      "subscription",
      "terms",
    ]);
    expect(listed.documents[2]).toEqual({
      acceptanceRef: terms.acceptanceRef,
      documentId: "terms",
      version: "1",
      url: "https://inside.example.test/legal/terms/v1",
      acceptedAt: instant.toISOString(),
      screen: "first-sign-in",
      buttonLabel,
      shownTerms: null,
    });
    expect(listed.documents[0]).toMatchObject({
      screen: "checkout",
      buttonLabel: "Оформить подписку и оплатить 990 ₽",
      shownTerms,
    });
  });
});
