import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { accountId, assembleAccounts, bootstrapOwnerAccount } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants, assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
describe("Subscription Enrollment with real PostgreSQL", () => {
  let db: TestDatabase;
  let owner: string;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let now = new Date("2030-01-01T00:00:00.000Z");
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = (await bootstrapOwnerAccount(db.prisma, { issuer: "https://identity.example.test", subject: "enrollment-owner" }, "platform:admin")).accountId;
    const accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-enrollment-fingerprint-key" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, recipientLinks: new TelegramAccountLinks(db.prisma), clock: () => now });
    membership = assembleMembershipEntitlements({ prisma: db.prisma, clock: () => now,
      workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma, clock: () => now }) });
  });
  afterAll(async () => db.dispose());
  async function customer() {
    const id = randomUUID();
    await db.prisma.account.create({ data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id } });
    return id;
  }
  const terms = { startsAt: "2030-01-01T00:00:00.000Z", endsAt: null, endPolicy: "fixed" };
  test("course repeat is one origin, revoke survives retries, restore retains identity and first start", async () => {
    const target = await customer();
    const tier = { id: randomUUID(), revision: 1, name: "Материалы + сообщество", benefits: ["materials", "community"], contentScope: { guideIds: [randomUUID()], materialIds: [] } };
    const command = { operationId: randomUUID(), accountId: target, origin: "course", sourceRef: `course:${target}`, tierId: tier.id, tierRevision: 1, terms, billingRef: null, reason: "Verified course" };
    const [a, b] = await Promise.all([grants.assignEnrollment(owner, command, tier), grants.assignEnrollment(owner, command, tier)]);
    expect(a).toEqual(b);
    const enrolled = value(a);
    const revoked = value(await grants.changeEnrollment(owner, { operationId: randomUUID(), enrollmentId: enrolled.id, expectedRevision: 1, action: "revoke", terms, reason: "Owner decision" }));
    expect(revoked.state).toBe("revoked");
    expect(value(await grants.assignEnrollment(owner, { ...command, operationId: randomUUID() }, tier)).state).toBe("revoked");
    expect(value(await grants.changeEnrollment(owner, { operationId: randomUUID(), enrollmentId: enrolled.id, expectedRevision: 2, action: "restore", terms, reason: "Confirmed restoration" })).state).toBe("active");
    expect(await db.prisma.subscriptionEnrollment.count({ where: { accountId: target } })).toBe(1);
    expect(await db.prisma.accessGrant.count({ where: { accountId: target } })).toBe(1);
    expect(await db.prisma.billingPurchase.count({ where: { accountId: target } })).toBe(0);
    expect(await grants.assignEnrollment(owner, { ...command, operationId: randomUUID(), accountId: await customer() }, tier)).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
  });
  test("scope cannot open another product or community, exact interval needs no worker", async () => {
    now = new Date(terms.startsAt);
    const target = await customer();
    const guide = randomUUID(); const material = randomUUID();
    const tier = { id: randomUUID(), revision: 1, name: "Выбранные материалы", benefits: ["materials"], contentScope: { guideIds: [guide], materialIds: [material] } };
    const end = "2030-02-01T00:00:00.000Z";
    value(await grants.assignEnrollment(owner, { operationId: randomUUID(), accountId: target, origin: "manual", sourceRef: randomUUID(), tierId: tier.id, tierRevision: 1, terms: { ...terms, endsAt: end }, billingRef: null, reason: "Explicit composition" }, tier));
    expect(await membership.resolveForAccess(accountId(target), [guide])).toMatchObject({ kind: "active" });
    expect(await membership.resolveForAccess(accountId(target), [], material)).toMatchObject({ kind: "active" });
    expect(await membership.resolveForAccess(accountId(target), [randomUUID()])).not.toMatchObject({ kind: "active" });
    expect(await grants.resolveCapabilities(target)).toMatchObject({ ok: true, capabilities: [{ capability: "materials", validUntil: end }] });
    now = new Date(end);
    expect(await membership.resolveForAccess(accountId(target), [guide])).toMatchObject({ kind: "expired" });
  });
  test("paid scope expansion preserves source revisions and refund revokes partial and late fulfillment", async () => {
    now = new Date(terms.startsAt);
    const target = await customer(), purchaseRef = randomUUID();
    const tier = { id: randomUUID(), revision: 1, name: "Paid snapshot", benefits: ["materials" as const, "community" as const], contentScope: { guideIds: [randomUUID()], materialIds: [] } };
    const paidTerms = { capabilities: ["materials" as const], startsAt: terms.startsAt, validUntil: "2030-02-01T00:00:00.000Z", reason: "Confirmed payment" };
    const enrollment = { purchaseRef, billingRef: randomUUID(), tier, startsAt: terms.startsAt, endsAt: paidTerms.validUntil };
    const command = { eventRef: randomUUID(), periodRef: `${purchaseRef}:materials`, accountId: target, revision: 1, revoked: false, terms: paidTerms, enrollment };
    expect(await grants.applyPaidPeriod(command)).toMatchObject({ ok: true });
    const row = await db.prisma.subscriptionEnrollment.findFirstOrThrow({ where: { accountId: target } });
    const expanded = { ...tier, revision: 2, benefits: [...tier.benefits, "support"], contentScope: { ...tier.contentScope, materialIds: [randomUUID()] } };
    const preview = value(await grants.previewEnrollmentExpansion(owner, { operationId: randomUUID(), tierId: tier.id, tierRevision: 2,
      targets: [{ enrollmentId: row.id, expectedRevision: 1, tierRevision: 1 }], reason: "Approved cohort expansion" }, expanded));
    expect(await grants.applyEnrollmentExpansion(owner, { operationId: randomUUID(), previewRef: preview.previewRef })).toMatchObject({ ok: true });
    expect(await db.prisma.accessGrant.count({ where: { accountId: target, capabilities: { has: "community" } } })).toBe(0);
    expect(await grants.applyPaidPeriod({ ...command, eventRef: randomUUID(), periodRef: `${purchaseRef}:community`, terms: { ...paidTerms, capabilities: ["community"], validUntil: "2030-01-15T00:00:00.000Z" } })).toMatchObject({ ok: true });
    expect(await grants.applyPaidPeriod({ ...command, eventRef: randomUUID(), revision: 2, revoked: true })).toMatchObject({ ok: true });
    expect(await db.prisma.accessGrant.count({ where: { accountId: target, revokedAt: null } })).toBe(0);
    expect(await db.prisma.accessGrant.findMany({ where: { accountId: target, capabilities: { has: "community" } } })).toMatchObject([{ validUntil: new Date("2030-01-15T00:00:00.000Z"), contentScope: expanded.contentScope }]);
    expect(await grants.applyPaidPeriod({ eventRef: randomUUID(), periodRef: `${purchaseRef}:community`, accountId: target, revision: 3, revoked: false, terms: { ...paidTerms, capabilities: ["community"] } })).toMatchObject({ ok: true });
    expect(await db.prisma.accessGrant.count({ where: { accountId: target, revokedAt: null } })).toBe(0);
    const second = await customer(), secondPurchase = randomUUID();
    expect(await grants.applyPaidPeriod({ ...command, eventRef: randomUUID(), accountId: second, periodRef: `${secondPurchase}:materials`, enrollment: { ...enrollment, purchaseRef: secondPurchase,
      benefitTerms: [paidTerms, { ...paidTerms, capabilities: ["community"], validUntil: "2030-01-15T00:00:00.000Z" }] } })).toMatchObject({ ok: true });
    expect(await db.prisma.accessGrant.count({ where: { accountId: second } })).toBe(2);
    const ownerView = value(await grants.listEnrollments(owner, second));
    expect(ownerView[0]?.benefitTerms).toEqual(expect.arrayContaining([{ capability: "community", startsAt: terms.startsAt, endsAt: "2030-01-15T00:00:00.000Z", revoked: false }]));
    expect(await membership.resolveManyForAccess?.(accountId(second), [{ guideIds: tier.contentScope.guideIds }, { guideIds: [randomUUID()] }])).toMatchObject([{ kind: "active" }, { kind: "required" }]);
  });
  test("Tribute cannot be granted or changed to an indefinite period", async () => {
    const target = await customer();
    const tier = { id: randomUUID(), revision: 1, name: "Tribute", benefits: ["community"], contentScope: { guideIds: [], materialIds: [] } };
    const command = { operationId: randomUUID(), accountId: target, origin: "tribute", sourceRef: randomUUID(), tierId: tier.id, tierRevision: 1, terms, billingRef: null, reason: "Verified external membership" };
    expect(await grants.assignEnrollment(owner, command, tier)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const row = value(await grants.assignEnrollment(owner, { ...command, terms: { ...terms, endsAt: "2030-02-01T00:00:00.000Z", endPolicy: "confirmed_external" } }, tier));
    expect(await grants.changeEnrollment(owner, { operationId: randomUUID(), enrollmentId: row.id, expectedRevision: 1, action: "change_term", terms, reason: "Cannot erase external bound" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("recipient lookup is authorized, current and unambiguous; relink cannot assign another identity", async () => {
    const target = await customer(), identityRef = `verified:${target}`;
    const lookup = () => grants.lookupRecipient(owner, identityRef);
    expect(await lookup()).toMatchObject({ ok: true, state: "not_found" });
    await db.prisma.telegramAccountLinkState.create({ data: { accountId: target, linkRef: randomUUID(), revision: 1, principalRef: `account:${target}`, identityRef, updatedAt: now } });
    expect(await lookup()).toMatchObject({ ok: true, state: "found", recipient: { accountId: target, identityRef, linkRevision: 1 } });
    expect(await grants.lookupRecipient(target, identityRef)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const duplicate = await customer();
    await db.prisma.telegramAccountLinkState.create({ data: { accountId: duplicate, linkRef: randomUUID(), revision: 1, principalRef: `account:${duplicate}`, identityRef, updatedAt: now } });
    expect(await lookup()).toMatchObject({ ok: true, state: "ambiguous" });
    await db.prisma.telegramAccountLinkState.update({ where: { accountId: duplicate }, data: { identityRef: null, principalRef: null, revision: 2 } });
    const tier = { id: randomUUID(), revision: 1, name: "Verified recipient", benefits: ["materials"], contentScope: { guideIds: [], materialIds: [] } };
    const command = { operationId: randomUUID(), accountId: target, origin: "course", sourceRef: randomUUID(), courseSource: { policyRef: "verified-course", verifiedIdentityRef: identityRef }, tierId: tier.id, tierRevision: 1, terms, billingRef: null, reason: "Verified owner selection" };
    const assigned = await grants.assignEnrollment(owner, command, tier);
    expect(assigned).toMatchObject({ ok: true });
    await db.prisma.telegramAccountLinkState.update({ where: { accountId: target }, data: { identityRef: "relinked-identity", revision: 2 } });
    expect(await lookup()).toMatchObject({ ok: true, state: "not_found" });
    expect(await grants.assignEnrollment(owner, command, tier)).toEqual(assigned);
    expect(await grants.assignEnrollment(owner, { ...command, operationId: randomUUID(), sourceRef: randomUUID() }, tier)).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
    expect(await db.prisma.subscriptionEnrollment.count({ where: { accountId: target } })).toBe(1);
  });

});
