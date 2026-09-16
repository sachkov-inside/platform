import { assertDeclaredResponse } from "../support/declared-api.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import { bindingLookupResponseSchema } from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import schema from "../../../../docs/contracts/subscription-activation-v1/schema.json" with { type: "json" };
import { parsePlatformConfig, PLATFORM_CONFIG } from "../../src/config/platform-config.js";
import { assembleAccounts, bootstrapOwnerAccount } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants, courseSourceRef } from "../../src/modules/membership-entitlements/index.js";
import { SubscriptionActivation } from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { SubscriptionActivationController } from "../../src/modules/telegram-membership/features/activate-subscription/subscription-activation.controller.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
const version = "inside.subscription-activation.v1";
const ajv = new Ajv({ strict: true, allErrors: true }); addFormats.default(ajv); ajv.addSchema(schema);
const validateResponse = ajv.compile({ $ref: `${schema.$id}#/definitions/activationResponse` });
const validateBinding = ajv.compile({ $ref: `${schema.$id}#/definitions/bindingResponse` });
const validateEvidence = ajv.compile({ $ref: `${schema.$id}#/definitions/evidence` });
describe("course activation HTTP authority with real PostgreSQL", () => {
  let db: TestDatabase; let http: NestFastifyApplication; let grants: ReturnType<typeof assembleAccessGrants>; let owner: string;
  let now = new Date("2030-01-01T00:00:00.000Z");
  const secret = "test-subscription-source-authority";
  const otherAuthority = "test-membership-evidence-authority";
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = (await bootstrapOwnerAccount(db.prisma, { issuer: "https://activation.example.test", subject: "owner" }, "platform:admin")).accountId;
    const accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "activation-test-fingerprint-secret" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, recipientLinks: new TelegramAccountLinks(db.prisma), clock: () => now });
    const service = new SubscriptionActivation({ prisma: db.prisma, grants, bindings: new TelegramAccountLinks(db.prisma), readAdmission: () => Promise.resolve({ state: "checking", admissionRestriction: null }) });
    @Module({ controllers: [SubscriptionActivationController], providers: [
      { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      { provide: SubscriptionActivation, useValue: service },
      { provide: PLATFORM_CONFIG, useValue: parsePlatformConfig({ NODE_ENV: "test", TELEGRAM_ACTIVATION_INGRESS_SECRET: secret, TELEGRAM_EVIDENCE_INGRESS_SECRET: otherAuthority, TELEGRAM_LINKING_SECRET: "test-linking-authority" }) },
    ] })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete fixture module.
    class FixtureModule {}
    http = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
    await http.init(); await http.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await http.close(); await db.dispose(); });
  async function send(path: string, payload: object, credential: string | null = secret) {
    const url = `/integrations/telegram/v1/subscription-activation/${path}`;
    const response = await http.inject({ method: "POST", url, headers: credential === null ? {} : { authorization: `Bearer ${credential}` }, payload });
    assertDeclaredResponse({ method: "POST", url, status: response.statusCode, body: () => response.json() });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    if (response.statusCode === 200 && path === "binding") expect(validateBinding(response.json()), JSON.stringify(validateBinding.errors)).toBe(true);
    else if (response.statusCode === 200 && path !== "own-access") expect(validateResponse(response.json()), JSON.stringify(validateResponse.errors)).toBe(true);
    return response;
  }
  async function lookup(identityRef: string) {
    const response = await send("binding", { contractVersion: version, identityRef });
    return bindingLookupResponseSchema.parse(response.json());
  }
  async function linkedSnapshot(identityRef: string) {
    const result = await lookup(identityRef);
    if (!result.ok || result.value.state !== "linked") throw new Error("Expected current binding");
    return result.value.binding;
  }
  async function setup() {
    now = new Date("2030-01-01T00:00:00.000Z");
    const id = randomUUID(); const identityRef = `telegram:${randomUUID()}`; const policy = `course:${id}`;
    await db.prisma.account.create({ data: { id, logtoIssuer: "https://activation.example.test", logtoSubject: id } });
    const tier = await db.prisma.billingOffer.create({ data: { id: randomUUID(), name: "Подписка Inside", benefits: ["materials", "community"], availableForAssignment: true, contentScope: { guideIds: [randomUUID()], materialIds: [] }, revision: 1 } });
    const rule = { id: randomUUID(), code: randomUUID(), name: "Курс", tierId: tier.id, tierRevision: 1, sourceRef: policy, published: true, startsAt: now.toISOString(), endsAt: null };
    expect(await grants.manageActivationRule(owner, { operationId: randomUUID(), value: rule, reason: "Confirmed course source" })).toMatchObject({ ok: true });
    return { id, identityRef, policy, tier, rule };
  }
  test("pending source does not grant; two links and owner assignment share one durable source", async () => {
    const context = await setup(); const attemptId = randomUUID();
    expect(await grants.registerSourceEntitlement(owner, { operationId: randomUUID(), origin: "course", sourcePolicyRef: context.policy, identityRef: context.identityRef, checkedAt: now.toISOString(), startsAt: now.toISOString(), endsAt: null, reason: "Verified purchase before Account binding" })).toMatchObject({ ok: true });
    expect(await db.prisma.accessGrant.count({ where: { accountId: context.id } })).toBe(0);
    const begin = { contractVersion: version, attemptId, code: context.rule.code, identityRef: context.identityRef };
    expect((await send("attempts", begin, "wrong-secret")).statusCode).toBe(401);
    expect((await send("attempts", begin)).json()).toMatchObject({ ok: true, value: { state: "needs_account" } });
    const accountRef = await linkTelegramAccount(db.prisma, { accountId: context.id, identityRef: context.identityRef, now });
    const binding = await new TelegramAccountLinks(db.prisma).readBinding({ accountId: context.id });
    if (!binding.ok || binding.binding === null) throw new Error("Fixture binding missing");
    const evidence = { contractVersion: version, audience: "inside.platform.subscription-activation", evidenceRef: randomUUID(), attemptId, sourceRef: context.policy, identityRef: context.identityRef, accountRef,
      linkRef: binding.binding.linkRef, linkRevision: binding.binding.linkRevision, ruleId: context.rule.id, ruleRevision: 1, checkedAt: now.toISOString(), validUntil: "2030-01-01T00:04:00.000Z", decision: "member" };
    expect(validateEvidence(evidence), JSON.stringify(validateEvidence.errors)).toBe(true);
    for (const patch of [{ audience: "wrong" }, { linkRevision: 2 }, { ruleRevision: 2 }, { identityRef: "another-person" }, { validUntil: now.toISOString() }]) {
      expect((await send("evidence", { ...evidence, ...patch, evidenceRef: randomUUID() })).json()).toMatchObject({ ok: false });
    }
    expect((await send("evidence", { ...evidence, decision: "not_member", evidenceRef: randomUUID() })).json()).toMatchObject({ value: { state: "rejected" } });
    expect((await send("evidence", { ...evidence, decision: "unavailable", evidenceRef: randomUUID() })).json()).toMatchObject({ value: { state: "unavailable" } });
    expect(await db.prisma.subscriptionEnrollment.count({ where: { accountId: context.id } })).toBe(0);
    const [first, retry] = await Promise.all([send("evidence", evidence), send("evidence", evidence)]);
    expect(first.json()).toEqual(retry.json()); expect(first.json()).toMatchObject({ ok: true, value: { state: "active" } });
    const source = await db.prisma.sourceEntitlement.findUniqueOrThrow({ where: { origin_sourceRef: { origin: "course", sourceRef: courseSourceRef(context.policy, context.identityRef) } } });
    expect(source.accountId).toBe(context.id); expect(source.enrollmentId).not.toBeNull();
    const row = await db.prisma.subscriptionEnrollment.findUniqueOrThrow({ where: { id: source.enrollmentId ?? "" } });
    const terms = { startsAt: row.startsAt.toISOString(), endsAt: null, endPolicy: "fixed" };
    expect(await grants.assignEnrollment(owner, { operationId: randomUUID(), accountId: context.id, origin: "course", sourceRef: source.sourceRef, courseSource: { policyRef: context.policy, verifiedIdentityRef: context.identityRef }, tierId: context.tier.id, tierRevision: 1, terms, billingRef: null, reason: "Owner repeats confirmed course" }, row.snapshot)).toMatchObject({ ok: true, value: { id: row.id } });
    expect(await grants.changeEnrollment(owner, { operationId: randomUUID(), enrollmentId: row.id, expectedRevision: 1, action: "revoke", terms, reason: "Owner revocation" })).toMatchObject({ ok: true });
    const rule2 = { ...context.rule, id: randomUUID(), code: randomUUID() };
    expect(await grants.manageActivationRule(owner, { operationId: randomUUID(), value: rule2, reason: "Second link same course" })).toMatchObject({ ok: true });
    const secondAttempt = randomUUID(); await send("attempts", { ...begin, attemptId: secondAttempt, code: rule2.code });
    expect((await send("evidence", { ...evidence, attemptId: secondAttempt, ruleId: rule2.id, evidenceRef: randomUUID() })).json()).toMatchObject({ ok: true, value: { state: "pending_review", enrollment: { id: row.id, state: "revoked" } } });
    expect(await db.prisma.subscriptionEnrollment.count({ where: { accountId: context.id } })).toBe(1);
    expect(await db.prisma.billingPurchase.count({ where: { accountId: context.id } })).toBe(0);
    const own = await send("own-access", { contractVersion: version, accountRef, identityRef: context.identityRef, linkRef: binding.binding.linkRef, linkRevision: binding.binding.linkRevision });
    const validateOwn = ajv.compile({ $ref: `${schema.$id}#/definitions/ownAccessResponse` });
    expect(validateOwn(own.json()), JSON.stringify(validateOwn.errors)).toBe(true);
    expect(own.json()).toMatchObject({ ok: true, value: { admission: { state: "checking" } } });
    now = new Date("2030-01-01T00:10:00.000Z");
    await db.prisma.billingOffer.update({ where: { id: context.tier.id }, data: { archived: true, revision: { increment: 1 } } });
    expect((await send("evidence", evidence)).json()).toEqual(first.json());
    expect((await send("evidence", { ...evidence, decision: "not_member" })).json()).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
    await grants.manageActivationRule(owner, { operationId: randomUUID(), expectedRevision: 1, value: { ...rule2, published: false }, reason: "Pause" });
    expect((await send("attempts", { ...begin, attemptId: randomUUID(), code: rule2.code })).json()).toMatchObject({ ok: false, error: { code: "policy_paused" } });
  });
  test("published rule explicitly rebinds to a new tier revision and retains the same activation link", async () => {
    const context = await setup();
    const accountRef = await linkTelegramAccount(db.prisma, { accountId: context.id, identityRef: context.identityRef, now });
    const binding = await new TelegramAccountLinks(db.prisma).readBinding({ accountId: context.id });
    if (!binding.ok || binding.binding === null) throw new Error("Missing fixture binding");
    await db.prisma.billingOffer.update({ where: { id: context.tier.id }, data: { name: "Новое название", revision: 2 } });
    const attemptId = randomUUID();
    const begin = { contractVersion: version, attemptId, code: context.rule.code, identityRef: context.identityRef };
    await send("attempts", begin);
    const evidence = { contractVersion: version, audience: "inside.platform.subscription-activation", evidenceRef: randomUUID(), attemptId,
      sourceRef: context.policy, identityRef: context.identityRef, accountRef, linkRef: binding.binding.linkRef,
      linkRevision: binding.binding.linkRevision, ruleId: context.rule.id, ruleRevision: 1,
      checkedAt: now.toISOString(), validUntil: "2030-01-01T00:04:00.000Z", decision: "member" };
    expect((await send("evidence", evidence)).json()).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
    const repair = { operationId: randomUUID(), expectedRevision: 1, value: { ...context.rule, tierRevision: 2 }, reason: "Explicit owner rebind" };
    expect(await grants.manageActivationRule(owner, repair)).toMatchObject({ ok: true, value: { revision: 2, code: context.rule.code, sourceRef: context.policy } });
    expect(await grants.manageActivationRule(owner, { ...repair, operationId: randomUUID() })).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
    const nextAttempt = randomUUID();
    expect((await send("attempts", { ...begin, attemptId: nextAttempt })).json()).toMatchObject({ ok: true, value: { rule: { revision: 2 } } });
    expect((await send("evidence", { ...evidence, attemptId: nextAttempt, evidenceRef: randomUUID(), ruleRevision: 2 })).json()).toMatchObject({ ok: true, value: { state: "active", enrollment: { tier: { revision: 2, name: "Новое название" } } } });
  });

  test("binding lookup requires the separate authority and returns only the exact current wire identity", async () => {
    const context = await setup();
    const query = { contractVersion: version, identityRef: context.identityRef };
    for (const credential of [null, "", "invalid-key", otherAuthority, "test-linking-authority"])
      expect((await send("binding", query, credential)).statusCode).toBe(401);
    for (const input of [{ identityRef: context.identityRef }, { ...query, contractVersion: "inside.subscription-activation.v2" },
      { ...query, identityRef: "" }, { ...query, identityRef: "x".repeat(257) }, { ...query, identityRef: 123 },
      { ...query, accountId: context.id }, { ...query, username: "synthetic-name" }])
      expect((await send("binding", input)).json()).toEqual({ ok: false, error: { code: "invalid_input" } });
    expect(await lookup(context.identityRef)).toEqual({ ok: true, value: { contractVersion: version, state: "unlinked" } });
    const accountRef = await linkTelegramAccount(db.prisma, { accountId: context.id, identityRef: context.identityRef, now });
    const current = await db.prisma.telegramAccountLinkState.findUniqueOrThrow({ where: { accountId: context.id } });
    const browserTransaction = await db.prisma.telegramLinkTransaction.findFirstOrThrow({ where: { accountId: context.id, status: "linked" } });
    const binding = await linkedSnapshot(context.identityRef);
    expect(binding).toEqual({ accountRef, identityRef: context.identityRef, linkRef: current.linkRef, linkRevision: current.revision });
    expect(binding.linkRef).not.toBe(browserTransaction.linkRef);
    expect(JSON.stringify(binding)).not.toContain(context.id);
    expect(await db.prisma.subscriptionEnrollment.count({ where: { accountId: context.id } })).toBe(0);
    await db.prisma.telegramLinkTransaction.update({ where: { linkRef: browserTransaction.linkRef }, data: { status: "expired" } });
    expect(await db.prisma.telegramAccountLinkState.findUniqueOrThrow({ where: { accountId: context.id } })).toMatchObject({ identityRef: null, principalRef: null });
    expect(await lookup(context.identityRef)).toEqual({ ok: true, value: { contractVersion: version, state: "unlinked" } });
  });
  test("binding lookup fails closed on ambiguity, malformed stored refs and PostgreSQL read failure", async () => {
    const context = await setup(), duplicate = await setup();
    await linkTelegramAccount(db.prisma, { accountId: context.id, identityRef: context.identityRef, now });
    await linkTelegramAccount(db.prisma, { accountId: duplicate.id, identityRef: context.identityRef, now });
    expect(await lookup(context.identityRef)).toEqual({ ok: false, error: { code: "identity_conflict" } });
    await db.prisma.telegramLinkTransaction.updateMany({ where: { accountId: duplicate.id, status: "linked" }, data: { status: "expired" } });
    await db.prisma.telegramAccountLinkState.update({ where: { accountId: context.id }, data: { principalRef: "" } });
    expect(await lookup(context.identityRef)).toEqual({ ok: false, error: { code: "unavailable" } });
    // The isolated database is this test's provider; no synthetic successful fallback is allowed.
    await db.prisma.$executeRaw`alter table telegram_membership.account_link_states rename to unavailable_link_states`;
    try { expect(await lookup(context.identityRef)).toEqual({ ok: false, error: { code: "unavailable" } }); }
    finally { await db.prisma.$executeRaw`alter table telegram_membership.unavailable_link_states rename to account_link_states`; }
    expect(await db.prisma.accessGrant.count({ where: { accountId: context.id } })).toBe(0);
  });
  test("relink after HTTP lookup rejects stale evidence and own-access; refreshed snapshot works and replay stays durable", async () => {
    const context = await setup();
    await linkTelegramAccount(db.prisma, { accountId: context.id, identityRef: context.identityRef, now });
    const oldBinding = await linkedSnapshot(context.identityRef);
    const attemptId = randomUUID();
    await send("attempts", { contractVersion: version, attemptId, code: context.rule.code, identityRef: context.identityRef });
    const evidence = { contractVersion: version, audience: "inside.platform.subscription-activation", evidenceRef: randomUUID(), attemptId,
      sourceRef: context.policy, identityRef: oldBinding.identityRef, accountRef: oldBinding.accountRef, linkRef: oldBinding.linkRef,
      linkRevision: oldBinding.linkRevision, ruleId: context.rule.id, ruleRevision: 1,
      checkedAt: now.toISOString(), validUntil: "2030-01-01T00:04:00.000Z", decision: "member" };
    await db.prisma.telegramLinkTransaction.updateMany({ where: { accountId: context.id, status: "linked" }, data: { status: "expired" } });
    await linkTelegramAccount(db.prisma, { accountId: context.id, identityRef: context.identityRef, now });
    expect((await send("evidence", evidence)).json()).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
    expect((await send("own-access", { contractVersion: version, ...oldBinding })).json()).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
    expect(await db.prisma.subscriptionEnrollment.count({ where: { accountId: context.id } })).toBe(0);
    const current = await linkedSnapshot(context.identityRef);
    expect(current.linkRevision).toBeGreaterThan(oldBinding.linkRevision);
    const freshEvidence = { ...evidence, ...current, evidenceRef: randomUUID() };
    const granted = await send("evidence", freshEvidence);
    expect(granted.json()).toMatchObject({ ok: true, value: { state: "active" } });
    expect((await send("own-access", { contractVersion: version, ...current })).json()).toMatchObject({ ok: true, value: { enrollments: [{ state: "active" }] } });
    await db.prisma.telegramLinkTransaction.updateMany({ where: { accountId: context.id, status: "linked" }, data: { status: "expired" } });
    expect(await lookup(context.identityRef)).toMatchObject({ ok: true, value: { state: "unlinked" } });
    expect((await send("own-access", { contractVersion: version, ...current })).json()).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
    expect((await send("evidence", freshEvidence)).json()).toEqual(granted.json());
    expect(await db.prisma.subscriptionEnrollment.count({ where: { accountId: context.id } })).toBe(1);
  });

});
