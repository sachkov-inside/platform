import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BillingContact } from "../../src/modules/accounts/facets/billing-contact/billing-contact.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import type { LegalDocument } from "../../src/modules/accounts/facets/billing-contact/billing-contact.contract.js";
import { syntheticConsentDocument } from "./setup/consent-documents.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const protection = billingContactProtection(
  Buffer.alloc(32, 42).toString("base64"),
);
const document = (
  kind: LegalDocument["kind"],
  version = "test-v1",
): LegalDocument => syntheticConsentDocument(kind, { version });
describe("Billing contact and consent evidence (real PostgreSQL, synthetic email)", () => {
  let database: TestDatabase;
  let instant = new Date("2026-09-08T12:00:00Z");
  const messages: { email: string; code: string; challengeRef: string }[] = [];
  function messageFor(challengeRef: string) {
    const message = messages.find(
      (candidate) => candidate.challengeRef === challengeRef,
    );
    if (!message) throw new Error("Missing synthetic message");
    return message;
  }
  let billing: BillingContact;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    billing = new BillingContact({
      prisma: database.prisma,
      protection,
      sendCode: (message) => {
        messages.push(message);
        return Promise.resolve();
      },
      documents: [document("terms"), document("recurring")],
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
        telegramSubjectRef: randomUUID(),
      },
    });
    return id;
  }
  const advance = () => {
    instant = new Date(instant.getTime() + 61_000);
  };
  async function verify(
    accountId: string,
    email: string,
    expectedRevision = 0,
  ) {
    const start = await billing.start(accountId, {
      operationId: randomUUID(),
      email,
      expectedRevision,
    });
    expect(start.ok).toBe(true);
    if (!start.ok) throw new Error(start.error.code);
    const message = messages.find(
      (message) => message.challengeRef === start.challengeRef,
    );
    if (!message) throw new Error("Missing synthetic message");
    const command = {
      operationId: randomUUID(),
      challengeRef: start.challengeRef,
      code: message.code,
    };
    const confirmed = await billing.confirm(accountId, command);
    expect(confirmed).toEqual({ ok: true, revision: expectedRevision + 1 });
    return command;
  }
  test("unknown Account cannot send; verification is Account-bound and leaves Logto fingerprint unchanged", async () => {
    const owner = await account();
    const stranger = await account();
    const command = {
      operationId: randomUUID(),
      email: "Buyer@Example.Test",
      expectedRevision: 0,
    };
    const count = messages.length;
    expect(await billing.start(randomUUID(), command)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(messages).toHaveLength(count);
    const [first, replay] = await Promise.all([
      billing.start(owner, command),
      billing.start(owner, command),
    ]);
    expect(first.ok && replay.ok).toBe(true);
    expect(messages).toHaveLength(count + 1);
    if (!first.ok) throw new Error("start failed");
    const message = messageFor(first.challengeRef);
    const confirm = {
      operationId: randomUUID(),
      challengeRef: first.challengeRef,
      code: message.code,
    };
    expect(await billing.confirm(stranger, confirm)).toEqual({
      ok: false,
      error: { code: "challenge_invalid" },
    });
    expect(await billing.read(owner)).toMatchObject({
      ok: true,
      contact: null,
    });
    expect(await billing.confirm(owner, confirm)).toEqual({
      ok: true,
      revision: 1,
    });
    expect(await billing.confirm(owner, confirm)).toEqual({
      ok: true,
      revision: 1,
    });
    expect(await billing.read(owner)).toMatchObject({
      ok: true,
      contact: { email: "buyer@example.test", revision: 1 },
    });
    const row = await database.prisma.billingContact.findUniqueOrThrow({
      where: { accountId: owner },
    });
    expect(row.emailCiphertext).not.toContain("buyer");
    expect(() =>
      protection.open(stranger, row.emailCiphertext ?? ""),
    ).toThrow();
    expect(
      (
        await database.prisma.account.findUniqueOrThrow({
          where: { id: owner },
        })
      ).emailFingerprint,
    ).toBeNull();
    await verify(stranger, "buyer@example.test");
    expect(
      await database.prisma.account.count({
        where: { id: { in: [owner, stranger] } },
      }),
    ).toBe(2);
  });
  test("address change retains verified contact; superseded and expired codes fail", async () => {
    const owner = await account();
    await verify(owner, "old@example.test");
    advance();
    const old = await billing.start(owner, {
      operationId: randomUUID(),
      email: "discarded@example.test",
      expectedRevision: 1,
    });
    if (!old.ok) throw new Error("start failed");
    advance();
    const current = await billing.start(owner, {
      operationId: randomUUID(),
      email: "new@example.test",
      expectedRevision: 1,
    });
    if (!current.ok) throw new Error("start failed");
    expect(await billing.read(owner)).toMatchObject({
      contact: { email: "old@example.test", revision: 1 },
    });
    const oldCode = messageFor(old.challengeRef).code;
    expect(
      await billing.confirm(owner, {
        operationId: randomUUID(),
        challengeRef: old.challengeRef,
        code: oldCode,
      }),
    ).toMatchObject({ error: { code: "challenge_invalid" } });
    const code = messageFor(current.challengeRef).code;
    expect(
      await billing.confirm(owner, {
        operationId: randomUUID(),
        challengeRef: current.challengeRef,
        code,
      }),
    ).toEqual({ ok: true, revision: 2 });
    advance();
    const expired = await billing.start(owner, {
      operationId: randomUUID(),
      email: "late@example.test",
      expectedRevision: 2,
    });
    if (!expired.ok) throw new Error("start failed");
    instant = new Date(instant.getTime() + 600_000);
    expect(
      await billing.confirm(owner, {
        operationId: randomUUID(),
        challengeRef: expired.challengeRef,
        code: messageFor(expired.challengeRef).code,
      }),
    ).toMatchObject({ error: { code: "challenge_invalid" } });
    expect(await billing.read(owner)).toMatchObject({
      contact: { email: "new@example.test", revision: 2 },
    });
  });
  test("wrong-code budget persists across retries and parallel requests; operation payloads cannot change", async () => {
    const owner = await account();
    const operationId = randomUUID();
    const start = await billing.start(owner, {
      operationId,
      email: "attempts@example.test",
      expectedRevision: 0,
    });
    if (!start.ok) throw new Error("start failed");
    expect(
      await billing.start(owner, {
        operationId,
        email: "other@example.test",
        expectedRevision: 0,
      }),
    ).toMatchObject({ error: { code: "operation_conflict" } });
    const correct = messageFor(start.challengeRef).code;
    const wrong = correct === "000000" ? "000001" : "000000";
    const bad = {
      operationId: randomUUID(),
      challengeRef: start.challengeRef,
      code: wrong,
    };
    await Promise.all([
      billing.confirm(owner, bad),
      billing.confirm(owner, bad),
    ]);
    expect(
      (
        await database.prisma.billingContactChallenge.findUniqueOrThrow({
          where: { id: start.challengeRef },
        })
      ).attempts,
    ).toBe(1);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        billing.confirm(owner, { ...bad, operationId: randomUUID() }),
      ),
    );
    expect(
      await billing.confirm(owner, { ...bad, code: correct }),
    ).toMatchObject({ error: { code: "operation_conflict" } });
    expect(
      await billing.confirm(owner, {
        ...bad,
        operationId: randomUUID(),
        code: correct,
      }),
    ).toMatchObject({ error: { code: "challenge_invalid" } });
  });
  test("recipient caps span Accounts; account cooldown serializes concurrent starts", async () => {
    const owner = await account();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        billing.start(owner, {
          operationId: randomUUID(),
          expectedRevision: 0,
          email: "cooldown@example.test",
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.ok && result.error.code === "rate_limited",
      ),
    ).toHaveLength(2);
    for (let index = 0; index < 10; index += 1) {
      expect(
        (
          await billing.start(await account(), {
            operationId: randomUUID(),
            expectedRevision: 0,
            email: "recipient-limit@example.test",
          })
        ).ok,
      ).toBe(true);
    }
    expect(
      await billing.start(await account(), {
        operationId: randomUUID(),
        expectedRevision: 0,
        email: "recipient-limit@example.test",
      }),
    ).toMatchObject({ error: { code: "rate_limited" } });
  });
  test("unknown send is durable and never automatically resent, including after reconstructing the facet", async () => {
    let calls = 0;
    const flaky = new BillingContact({
      prisma: database.prisma,
      protection,
      sendCode: () => {
        calls += 1;
        return Promise.reject(new Error("ambiguous SMTP outcome"));
      },
      documents: [],
      now: () => instant,
    });
    const owner = await account();
    const command = {
      operationId: randomUUID(),
      expectedRevision: 0,
      email: "unknown@example.test",
    };
    const first = await flaky.start(owner, command);
    expect(first).toMatchObject({ ok: true, delivery: "unknown" });
    expect(await billing.start(owner, command)).toEqual(first);
    expect(calls).toBe(1);
  });
  test("explicit kinds and exact editions remain immutable and replayable after document publication", async () => {
    const owner = await account();
    const terms = document("terms");
    const command = {
      operationId: randomUUID(),
      contextRef: randomUUID(),
      documents: [
        {
          kind: terms.kind,
          documentId: terms.documentId,
          version: terms.version,
          digest: terms.digest,
          accepted: true,
        },
      ],
    };
    expect(await billing.acceptConsents(owner, command)).toMatchObject({
      error: { code: "contact_required" },
    });
    await verify(owner, "consent@example.test");
    expect(
      await billing.acceptConsents(owner, {
        ...command,
        documents: [{ ...command.documents[0], accepted: false }],
      }),
    ).toMatchObject({ error: { code: "invalid_input" } });
    const accepted = await billing.acceptConsents(owner, command);
    expect(accepted.ok).toBe(true);
    expect(await billing.acceptConsents(owner, command)).toEqual(accepted);
    expect(
      await database.prisma.billingConsentEvidence.count({
        where: { accountId: owner, kind: "recurring" },
      }),
    ).toBe(0);
    const next = new BillingContact({
      prisma: database.prisma,
      protection,
      sendCode: undefined,
      documents: [document("terms", "test-v2")],
      now: () => instant,
    });
    expect(await next.acceptConsents(owner, command)).toEqual(accepted);
    expect(
      await next.acceptConsents(owner, {
        ...command,
        operationId: randomUUID(),
      }),
    ).toMatchObject({ error: { code: "document_changed" } });
    const evidence =
      await database.prisma.billingConsentEvidence.findFirstOrThrow({
        where: { accountId: owner },
      });
    expect(evidence.documentText).toBe(terms.text);
    const { appliesTo: _catalogueOnly, ...acceptedTerms } = terms;
    expect(await next.readConsent(owner, evidence.id)).toMatchObject({
      ok: true,
      evidence: { contextRef: command.contextRef, document: acceptedTerms },
    });
    expect(await next.readConsent(await account(), evidence.id)).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(
      database.prisma.billingConsentEvidence.update({
        where: { id: evidence.id },
        data: { documentVersion: "test-v2" },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingConsentEvidence.delete({
        where: { id: evidence.id },
      }),
    ).rejects.toThrow();
  });
});
