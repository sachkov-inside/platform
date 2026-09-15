import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { accountId as checkedAccountId, assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants, assembleMembershipEntitlements, TributeSources, type AccessCapability } from "../../src/modules/membership-entitlements/index.js";
import { BillingNotices, BillingOperations, BillingPayments, BillingPricing, BillingSubscriptions, TributeConvergence } from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import type { OwnerOutcome, OwnerResult } from "../../src/modules/billing/domain/owner-operations.js";
import { assembleContentAccess, assembleCurrentAccountPermissions, type ContentAccess, type Resource } from "../../src/modules/content-access/index.js";
import { discoverPublishedMaterials } from "../../src/modules/content-library/index.js";
import { assembleGuideArtifactResourceFacts, assembleGuideArtifacts, assembleMaterialResourceFacts, assembleMaterials, materialId as checkedMaterialId, type MaterialId } from "../../src/modules/materials/index.js";
import { assembleVideoResourceFacts } from "../../src/modules/materials/adapters/content-access/video-resource-facts.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { createTestVideoProvider } from "../../src/modules/videos/adapters/kinescope/test-video-provider.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import type { ObjectStorage, StoredObject } from "../../src/infrastructure/object-storage/index.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  accessCellId,
  accessGrounds,
  accessScenarioTable,
  accessSurfaces,
  type AccessExpectation,
  type AccessGround,
  type AccessSurface,
  type AccessTerm,
  type AccessTransition,
} from "../access-scenarios/access-scenarios.js";
import { compareAccessObservation, type AccessObservation } from "../access-scenarios/check-access-scenarios.js";
import { BankFixture } from "./setup/bank.js";
import { syntheticConsentDocuments } from "./setup/consent-documents.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const config = syntheticTbankConfig({ environment: "demo", terminalKey: "SYNTHETICSCENARIOS", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 71).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  cardBinding: { confirmed: true, checkType: "3DS" }, minimumKopecks: 100, maximumKopecks: 10_000_000,
  returnUrl: "https://inside.example.test/account", notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" } });
const startedAt = "2030-01-31T10:00:00.000Z";
/** Сопровождение из предложения продукта: ровно шесть календарных месяцев с оплаты. */
const supportEndsAt = "2030-07-31T10:00:00.000Z";
const groundEndsAt = "2030-03-02T10:00:00.000Z";
const guidePriceKopecks = 290_000;

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
}
function owned(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code); return result.result;
}

/**
 * Исполнение таблицы сценариев доступа. Мир один на файл: руководство A с закрытым материалом,
 * видео и артефактом, предложение продукта с сопровождением и скрытый назначаемый тариф. Каждое
 * основание получает свой Account настоящим путём — оплатой через синтетический банк или
 * владельческой операцией, — а каждая клетка читается через публичный фасад и сравнивается с
 * ожиданием таблицы одной функцией.
 */
describe("таблица сценариев доступа (реальный PostgreSQL, синтетический банк)", () => {
  let db: TestDatabase;
  let now = new Date(startedAt);
  const owner = randomUUID();
  let accounts: ReturnType<typeof assembleAccounts>;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let pricing: BillingPricing;
  let contact: BillingContact;
  let operations: BillingOperations;
  let payments: BillingPayments;
  let bank: BankFixture;
  let materials: ReturnType<typeof assembleMaterials>;
  let videos: ReturnType<typeof assembleVideos>;
  let readerAccess: ContentAccess;
  let authorAccess: ContentAccess;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let convergence: TributeConvergence;
  let tributeSubscription = 648_000;
  const codes = new Map<string, string>();
  const objects = new Map<string, StoredObject>();
  const storage: ObjectStorage = {
    putImmutable: input => { objects.set(`${input.namespace}:${input.key}`, { body: input.body, checksumSha256: input.checksumSha256, contentLength: input.body.length, contentType: input.contentType }); return Promise.resolve({ ok: true }); },
    read: (namespace, key) => Promise.resolve(objects.get(`${namespace}:${key}`) ?? null),
    delete: (namespace, key) => { objects.delete(`${namespace}:${key}`); return Promise.resolve(); },
    signGet: input => Promise.resolve(`https://storage.example.test/${input.key}?ttl=${String(input.ttlSeconds)}`),
  };
  let topicId: string;
  let guideA: string;
  let guideSlug: string;
  let freeMaterial: MaterialId;
  let productMaterial: MaterialId;
  let videoId: string;
  let artifactId: string;
  let productOptionId: string;
  let tierId: string;
  const grounds = new Map<AccessGround, string | null>();

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    await db.prisma.account.create({ data: { id: owner, logtoIssuer: "https://identity.example.test", logtoSubject: owner } });
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-scenarios-fingerprint-key-00" });
    const links = new TelegramAccountLinks(db.prisma);
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, recipientLinks: links, clock: () => now });
    membership = assembleMembershipEntitlements({ prisma: db.prisma, recipientLinks: links, clock: () => now, workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma, clock: () => now }) });
    // Tribute открывает тариф только через реестр источника: политика, строка реестра и сверка.
    convergence = new TributeConvergence(db.prisma, new TributeSources({ prisma: db.prisma, accounts, links, clock: () => now }));
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
    contact = new BillingContact({ prisma: db.prisma, protection: billingContactProtection(Buffer.alloc(32, 72).toString("base64")),
      documents: syntheticConsentDocuments, now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
    bank = new BankFixture(config);
    const client = bank.client();
    payments = new BillingPayments({ prisma: db.prisma, bank: client, contact, grants, clock: () => now });
    const subscriptions = new BillingSubscriptions({ prisma: db.prisma, bank: client, contact, grants, payments,
      notices: new BillingNotices({ prisma: db.prisma, clock: () => now }), clock: () => now });
    operations = new BillingOperations({ prisma: db.prisma, accounts, pricing, payments, subscriptions, grants, bank: client, clock: () => now });
    materials = assembleMaterials({ prisma: db.prisma, authorPolicy: { canManage: id => id === owner }, guideAccessHolders: grants });
    videos = assembleVideos({ prisma: db.prisma, provider: createTestVideoProvider(), projects: { free: "free", membership: "members" }, canManage: () => Promise.resolve(false), clock: () => now });
    const guideArtifacts = assembleGuideArtifacts({ prisma: db.prisma, objectStorage: storage, authorPolicy: { canManage: id => id === owner } });
    const resources = { materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent), videoResourceFacts: assembleVideoResourceFacts(videos),
      guideArtifactResourceFacts: assembleGuideArtifactResourceFacts(guideArtifacts), membershipEntitlements: membership, clock: () => now };
    // Читатель — Account без разрешения автора. Автор — тот же Account с `materials:manage` из базы.
    readerAccess = assembleContentAccess({ ...resources, accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) } });
    authorAccess = assembleContentAccess({ ...resources, accountPermissions: assembleCurrentAccountPermissions(accounts) });

    topicId = randomUUID();
    await db.prisma.topic.create({ data: { id: topicId, slug: "scenario-topic", name: "Сценарии доступа" } });
    guideSlug = `scenario-guide-${randomUUID()}`;
    guideA = await guide(guideSlug);
    [freeMaterial, productMaterial] = await Promise.all([material([], "free"), material([guideA])]);
    videoId = randomUUID();
    const providerVideoId = randomUUID();
    await db.prisma.video.create({ data: { id: videoId, materialId: productMaterial, createdBy: owner, access: "membership", projectId: "members",
      providerVideoId, title: "Видео руководства", origin: "platform_upload", providerStatus: "done", state: "ready",
      readyAt: now, providerVisibleAt: now, providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`, durationSeconds: 60 } });
    await db.prisma.material.update({ where: { id: productMaterial }, data: { primaryVideoId: videoId } });
    const artifactBody = new TextEncoder().encode("# Артефакт руководства\n");
    const created = await guideArtifacts.create({ actor: owner, guideId: guideA, kind: "file",
      metadata: { access: "membership", purpose: "Сценарии доступа", title: "Закрытый артефакт" },
      file: { body: artifactBody, declaredContentType: "text/markdown", declaredSize: artifactBody.byteLength,
        expectedChecksumSha256: createHash("sha256").update(artifactBody).digest("hex"), filename: "scenario-artifact.md" } });
    if (!created.ok) throw new Error(created.error.code);
    artifactId = created.value.artifactId;

    productOptionId = (await productOffer(guideA)).optionId;
    tierId = await tier([guideA]);

    grounds.set("guest", null);
    grounds.set("account-without-rights", await account());
    grounds.set("one-time-purchase", await purchased(productOptionId));
    grounds.set("tier-via-course", await assigned("course", null));
    grounds.set("tier-via-tribute", await tributeMember(groundEndsAt));
    grounds.set("manual-assignment", await assigned("manual", groundEndsAt));
    const hiddenTier = await tier([guideA]);
    grounds.set("hidden-active-tier", await assigned("manual", groundEndsAt, hiddenTier));
    // Тариф прячется и из продажи, и из назначения: действующее назначение от этого не зависит.
    owned(await operations.execute(owner, { operation: "offers.save", operationId: randomUUID(), expectedRevision: 1,
      value: { id: hiddenTier, name: "Скрытый тариф", benefits: ["materials", "community"], availableForAssignment: false, contentScope: { guideIds: [guideA], materialIds: [] } } }));
    const revoked = await account();
    await revoke(await assignEnrollment("manual", revoked, groundEndsAt, tierId));
    grounds.set("expired-or-revoked", revoked);
    const multiple = await purchased(productOptionId);
    await assignEnrollment("manual", multiple, groundEndsAt, tierId);
    grounds.set("multiple-grounds", multiple);
    const refunded = await account();
    await refund(await pay(refunded, productOptionId));
    grounds.set("withdrawal-refund", refunded);
  });
  afterAll(async () => db.dispose());

  async function guide(slug: string): Promise<string> {
    const created = await materials.authoring.createContentCollection({ actor: owner, kind: "guide", name: slug, slug, summary: "" });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }
  async function material(guideIds: readonly string[], access: "free" | "membership" = "membership"): Promise<MaterialId> {
    const title = `Материал ${randomUUID()}`;
    const metadata = { title, summary: "Сценарий доступа", access, topicId, formatId: "guide", tagIds: [], difficulty: null, outcomes: [], seriesIds: [...guideIds] };
    const created = await materials.authoring.createDraft({ actor: owner, idempotencyKey: randomUUID(), metadata, body: representativeDocument(title) });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({ actor: owner, idempotencyKey: randomUUID(), materialId: created.value.materialId,
      expectedContentVersion: 1, publicationState: "published", metadata, body: representativeDocument(title) });
    if (!published.ok) throw new Error(published.error.code);
    return checkedMaterialId(created.value.materialId);
  }
  async function productOffer(guideId: string) {
    const offerId = randomUUID(), optionId = randomUUID();
    const capability: AccessCapability = `guide:${guideId}`;
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: { id: offerId, name: "Продукт сценариев",
      benefits: [capability, "support"], benefitPeriods: [{ capability, months: null }, { capability: "support", months: 6 }] } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", value: { id: optionId, offerId, mode: "one_time", months: 1, priceKopecks: guidePriceKopecks } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));
    return { offerId, optionId };
  }
  async function tier(guideIds: readonly string[]): Promise<string> {
    const id = randomUUID();
    owned(await operations.execute(owner, { operation: "offers.save", operationId: randomUUID(),
      value: { id, name: "Материалы + сообщество", benefits: ["materials", "community"], availableForAssignment: true, contentScope: { guideIds: [...guideIds], materialIds: [] } } }));
    return id;
  }
  async function account(): Promise<string> {
    const id = randomUUID();
    await db.prisma.account.create({ data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id } });
    const start = await contact.start(id, { operationId: randomUUID(), email: `${id}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    expect(await contact.confirm(id, { operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef) })).toMatchObject({ ok: true });
    return id;
  }
  async function pay(buyer: string, optionId: string): Promise<string> {
    const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
    const accepted = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef: quote.quoteRef,
      documents: syntheticConsentDocuments.filter(document => document.kind === "terms")
        .map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
    if (!accepted.ok) throw new Error(accepted.error.code);
    const bought = value(await payments.purchase(buyer, { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
      consentEvidenceRefs: accepted.evidenceRefs, acknowledgeExistingAccess: true }));
    expect(await payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
    value(await payments.recover());
    return bought.purchaseRef;
  }
  async function purchased(optionId: string): Promise<string> {
    const buyer = await account();
    await pay(buyer, optionId);
    return buyer;
  }
  /** Подписчик Tribute: подтверждённая строка реестра с оплаченным сроком прикрепляется к тарифу. */
  async function tributeMember(endsAt: string): Promise<string> {
    const recipient = await account();
    const identityRef = `tribute-${recipient}`;
    const principalRef = await linkTelegramAccount(db.prisma, { accountId: recipient, identityRef, now });
    expect(await membership.bindPrincipal({ accountId: checkedAccountId(recipient), principalRef })).toMatchObject({ ok: true });
    const policyRef = randomUUID();
    const subscriptionId = ++tributeSubscription;
    const revision = (await db.prisma.billingOffer.findUniqueOrThrow({ where: { id: tierId } })).revision;
    value(await convergence.savePolicy(owner, { operationId: randomUUID(), expectedRevision: 0, id: policyRef, subscriptionId, enabled: true,
      tierId, tierRevision: revision, temporaryUntil: null, reason: "Подтверждённый источник Tribute" }));
    const row = { rowRef: randomUUID(), policyRef, subscriptionId, identityRef, telegramUserId: String(subscriptionId), verificationRef: randomUUID(),
      checkedAt: now.toISOString(), mode: "confirmed_period" as const, startsAt: now.toISOString(), endsAt, renewal: "enabled" as const,
      expectedRevision: 0, reason: "Подтверждённые даты и identity" };
    const preview = value(await convergence.preview(owner, { operationId: randomUUID(), batchRef: row.rowRef, rows: [row] }));
    value(await convergence.apply(owner, { operationId: randomUUID(), previewRef: preview.previewRef, selectedRows: [row.rowRef] }));
    await convergence.sweep();
    return recipient;
  }
  async function assignEnrollment(origin: "course" | "manual", recipient: string, endsAt: string | null, tier: string) {
    const identityRef = `verified-${recipient}`;
    if (origin === "course") await linkTelegramAccount(db.prisma, { accountId: recipient, identityRef, now });
    const revision = (await db.prisma.billingOffer.findUniqueOrThrow({ where: { id: tier } })).revision;
    const terms = { startsAt: now.toISOString(), endsAt, endPolicy: "fixed" };
    const assignedEnrollment = owned(await operations.execute(owner, { operation: "enrollments.assign", operationId: randomUUID(), accountId: recipient,
      tierId: tier, tierRevision: revision, origin, sourceRef: `scenario-${randomUUID()}`, terms, billingRef: null, reason: "Сценарий доступа",
      ...(origin === "course" ? { courseSource: { policyRef: "scenario-course", verifiedIdentityRef: identityRef } } : {}) }));
    if (assignedEnrollment.outcome !== "enrollment") throw new Error(`Unexpected outcome ${assignedEnrollment.outcome}`);
    return { enrollmentId: assignedEnrollment.value.id, terms };
  }
  async function assigned(origin: "course" | "manual", endsAt: string | null, tier = tierId): Promise<string> {
    const recipient = await account();
    await assignEnrollment(origin, recipient, endsAt, tier);
    return recipient;
  }
  async function revoke(enrollment: { readonly enrollmentId: string; readonly terms: object }) {
    owned(await operations.execute(owner, { operation: "enrollments.change", operationId: randomUUID(), enrollmentId: enrollment.enrollmentId,
      expectedRevision: 1, action: "revoke", terms: enrollment.terms, reason: "Сценарий отзыва" }));
  }
  async function refund(purchaseRef: string) {
    const decided = owned(await operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: guidePriceKopecks, access: "revoke", recurring: "keep", reason: "Возврат по отказу от договора" }));
    if (decided.outcome !== "refundDecision") throw new Error(`Unexpected outcome ${decided.outcome}`);
    expect(owned(await operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(), decisionRef: decided.value.decisionRef, expectedRevision: 1 })))
      .toMatchObject({ outcome: "refundDecision", value: { state: "executed" } });
    value(await payments.recover());
  }

  // ---------------------------------------------------------------- наблюдение через фасады

  const open = (term: AccessTerm): AccessObservation => ({ outcome: "open", term });
  const subjectOf = (account: string | null) => account === null
    ? { kind: "anonymous" as const } : { kind: "account" as const, accountId: checkedAccountId(account) };
  function termOf(validUntil: string | null): AccessTerm {
    return validUntil === null ? "lifetime" : validUntil === supportEndsAt ? "six-months" : "ground-term";
  }
  /** Решение ContentAccess словами таблицы: `denied` — то, во что превращается отказ на этом ресурсе. */
  async function decision(access: ContentAccess, account: string | null, resource: Resource, denied: AccessObservation): Promise<AccessObservation> {
    const action = resource.kind === "video" ? "play" : resource.kind === "guideArtifact" ? "download" : "read";
    const enforcementPoint = resource.kind === "video" ? "playback_token_issue" : resource.kind === "guideArtifact" ? "guide_artifact_delivery" : "published_material_read";
    const decided = await access.authorize({ subject: subjectOf(account), action, resource, enforcementPoint, correlationId: randomUUID() });
    if (decided.effect === "deny") return denied;
    if (!("validUntil" in decided)) return open(decided.reason === "public_resource" ? "public" : "permission");
    return open(termOf(decided.validUntil));
  }
  async function capability(account: string | null, name: "community" | "support"): Promise<AccessObservation> {
    if (account === null) return { outcome: "closed" };
    const resolved = await grants.resolveCapabilities(account);
    if (!resolved.ok) throw new Error(resolved.error.code);
    const found = resolved.capabilities.find(entry => entry.capability === name);
    return found === undefined ? { outcome: "closed" } : open(termOf(found.validUntil));
  }
  async function programme(account: string | null, slug: string, id: MaterialId): Promise<AccessObservation> {
    const discovered = value(await discoverPublishedMaterials(materials.publishedMaterialReader, readerAccess, videos, { first: null, kind: "series", slug, subject: subjectOf(account) }));
    const item = discovered.items.find(entry => entry.materialId === id);
    if (item === undefined) throw new Error("Programme lost its Material");
    // Замок программы не несёт срока: он совпадает с решением по самому материалу.
    return item.availability === "available" ? decision(readerAccess, account, { kind: "material", materialId: id }, { outcome: "locked" }) : { outcome: "locked" };
  }

  /** Одна клетка: `null` — у основания нет Account, и клетка по таблице неприменима. */
  async function observe(surface: AccessSurface, account: string | null, material: MaterialId = productMaterial): Promise<AccessObservation | null> {
    switch (surface) {
      case "public-material": return decision(readerAccess, account, { kind: "material", materialId: freeMaterial }, { outcome: "closed" });
      case "product-material": return decision(readerAccess, account, { kind: "material", materialId: material }, { outcome: "locked" });
      case "programme": return programme(account, guideSlug, material);
      case "artifacts": return decision(readerAccess, account, { kind: "guideArtifact", artifactId }, { outcome: "locked" });
      case "video": return decision(readerAccess, account, { kind: "video", videoId }, { outcome: "closed" });
      case "community-chat": return capability(account, "community");
      case "support": return capability(account, "support");
      case "cabinet": {
        if (account === null) return null;
        const own = value(await grants.readOwnAccess(account));
        const active = own.grounds.filter(ground => ground.active);
        if (active.length === 0) return { outcome: "closed" };
        return open(active.some(ground => ground.validUntil === null) ? "lifetime" : "ground-term");
      }
      case "author": {
        if (account === null) return null;
        await db.prisma.accountPermission.upsert({ where: { accountId_permission: { accountId: account, permission: "materials:manage" } },
          create: { accountId: account, permission: "materials:manage" }, update: {} });
        return decision(authorAccess, account, { kind: "material", materialId: material }, { outcome: "locked" });
      }
      case "mcp": {
        if (account === null) return null;
        const loaded = await materials.authoring.loadMaterial({ actor: account, materialId: material });
        return loaded.ok ? open("permission") : { outcome: "closed" };
      }
    }
  }
  function verdict(id: string, expectation: AccessExpectation | undefined, observation: AccessObservation | null): string | null {
    if (expectation === undefined) return `${id} has no expectation`;
    if (observation === null) return expectation.outcome === "not-applicable" ? null : `${id} could not be observed`;
    return compareAccessObservation(id, expectation, observation);
  }

  // Автор идёт последним: разрешение `materials:manage` выдаётся Account основания прямо перед чтением.
  const surfaceOrder: readonly AccessSurface[] = [...accessSurfaces.filter(surface => surface !== "author"), "author"];
  test.each(surfaceOrder.flatMap(surface => accessGrounds.map(ground => [accessCellId(surface, ground), surface, ground] as const)))(
    "%s",
    async (id, surface, ground) => {
      now = new Date(startedAt);
      const account = grounds.get(ground);
      if (account === undefined) throw new Error(`Ground ${ground} was not prepared`);
      expect(verdict(id, accessScenarioTable.cells[surface][ground], await observe(surface, account))).toBeNull();
    },
  );

  // ------------------------------------------------------------------------------- переходы

  async function transitionVerdicts(id: AccessTransition, account: string, material: MaterialId = productMaterial): Promise<readonly string[]> {
    const after: Readonly<Partial<Record<AccessSurface, AccessExpectation>>> = accessScenarioTable.transitions[id].after;
    const verdicts = [];
    for (const surface of accessSurfaces) {
      const expectation = after[surface];
      if (expectation === undefined) continue;
      verdicts.push(verdict(`${id}:${surface}`, expectation, await observe(surface, account, material)));
    }
    return verdicts.filter((entry): entry is string => entry !== null);
  }

  test("expiry", async () => {
    now = new Date(startedAt);
    const recipient = await tributeMember(groundEndsAt);
    expect(await observe("product-material", recipient)).toEqual(open("ground-term"));
    try {
      now = new Date(groundEndsAt);
      expect(await transitionVerdicts("expiry", recipient)).toEqual([]);
    } finally { now = new Date(startedAt); }
  });

  test("revocation", async () => {
    now = new Date(startedAt);
    const recipient = await account();
    const enrollment = await assignEnrollment("manual", recipient, null, tierId);
    expect(await observe("product-material", recipient)).toEqual(open("lifetime"));
    await revoke(enrollment);
    expect(await transitionVerdicts("revocation", recipient)).toEqual([]);
  });

  test("refund", async () => {
    now = new Date(startedAt);
    const buyer = await account();
    const purchaseRef = await pay(buyer, productOptionId);
    expect(await observe("support", buyer)).toEqual(open("six-months"));
    await refund(purchaseRef);
    expect(await transitionVerdicts("refund", buyer)).toEqual([]);
  });

  test("tier-composition-change", async () => {
    now = new Date(startedAt);
    const guideC = await guide(`scenario-added-${randomUUID()}`);
    const added = await material([guideC]);
    const changing = await tier([guideA]);
    const recipient = await account();
    const enrollment = await assignEnrollment("manual", recipient, groundEndsAt, changing);
    const saved = owned(await operations.execute(owner, { operation: "offers.save", operationId: randomUUID(), expectedRevision: 1,
      value: { id: changing, name: "Материалы + сообщество", benefits: ["materials", "community"], availableForAssignment: true, contentScope: { guideIds: [guideA, guideC], materialIds: [] } } }));
    if (saved.outcome !== "catalog") throw new Error(`Unexpected outcome ${saved.outcome}`);
    // Новая редакция тарифа сама по себе ничего не открывает действующему назначению.
    expect(await observe("product-material", recipient, added)).toEqual({ outcome: "locked" });
    const preview = owned(await operations.execute(owner, { operation: "enrollments.previewExpansion", operationId: randomUUID(), tierId: changing,
      tierRevision: saved.value.revision, targets: [{ enrollmentId: enrollment.enrollmentId, expectedRevision: 1, tierRevision: 1 }], reason: "Расширение состава" }));
    if (preview.outcome !== "enrollmentExpansionPreview") throw new Error(`Unexpected outcome ${preview.outcome}`);
    owned(await operations.execute(owner, { operation: "enrollments.applyExpansion", operationId: randomUUID(), previewRef: preview.value.previewRef }));
    expect(await transitionVerdicts("tier-composition-change", recipient, added)).toEqual([]);
  });

  test("tier-archived-with-assignments", async () => {
    now = new Date(startedAt);
    const archivedTier = await tier([guideA]);
    const recipient = await assigned("manual", groundEndsAt, archivedTier);
    owned(await operations.execute(owner, { operation: "offers.archive", operationId: randomUUID(), id: archivedTier, expectedRevision: 1 }));
    expect(await operations.execute(owner, { operation: "enrollments.assign", operationId: randomUUID(), accountId: await account(), tierId: archivedTier,
      tierRevision: 2, origin: "manual", sourceRef: randomUUID(), terms: { startsAt: now.toISOString(), endsAt: null, endPolicy: "fixed" }, billingRef: null,
      reason: "Назначение по архивному тарифу" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await transitionVerdicts("tier-archived-with-assignments", recipient)).toEqual([]);
  });

  test("material-removed-from-product", async () => {
    now = new Date(startedAt);
    const buyer = await purchased(productOptionId);
    const otherGuide = await guide(`scenario-other-${randomUUID()}`);
    const removed = await material([guideA, otherGuide]);
    expect(await observe("product-material", buyer, removed)).toEqual(open("lifetime"));
    const current = await db.prisma.material.findUniqueOrThrow({ where: { id: removed } });
    // Команда сохранения несёт выбор автора целиком: тот же материал без купленного руководства.
    const metadata = { title: current.title, summary: current.summary, access: "membership" as const, topicId, formatId: "guide",
      tagIds: [], difficulty: null, outcomes: [], seriesIds: [otherGuide] };
    const save = (confirmedGuideRemovals: readonly string[]) => materials.authoring.saveMaterial({ actor: owner, idempotencyKey: randomUUID(), materialId: removed,
      expectedContentVersion: Number(current.contentVersion), publicationState: "published", metadata, body: representativeDocument(current.title ?? ""), confirmedGuideRemovals });
    expect(await save([])).toMatchObject({ ok: false, error: { code: "guide_removal_confirmation_required" } });
    expect(await observe("product-material", buyer, removed)).toEqual(open("lifetime"));
    expect(await save([guideA])).toMatchObject({ ok: true });
    expect(await transitionVerdicts("material-removed-from-product", buyer, removed)).toEqual([]);
  });

  test("guide-archived", async () => {
    now = new Date(startedAt);
    const archivedSlug = `scenario-archived-${randomUUID()}`;
    const archived = await guide(archivedSlug);
    const step = await material([archived]);
    const holder = await account();
    const preview = await grants.previewBatch(owner, { operationId: randomUUID(), rows: [{ rowKey: "guide", accountId: holder, source: "manual", sourceRef: randomUUID(),
      terms: { capabilities: [`guide:${archived}`], startsAt: startedAt, validUntil: null, reason: "Покупатель архивного руководства" } }] });
    if (!preview.ok) throw new Error(preview.error.code);
    expect(await grants.applyBatch(owner, { operationId: randomUUID(), previewRef: preview.previewRef, expectedRevision: preview.revision, confirmedRows: ["guide"] })).toMatchObject({ ok: true });
    const version = (await db.prisma.guide.findUniqueOrThrow({ where: { id: archived } })).version;
    expect(await materials.authoring.setContentCollectionArchive({ actor: owner, archived: true, collectionId: archived, expectedVersion: version, kind: "guide" })).toMatchObject({ ok: true });
    const archivedProgramme = await programme(holder, archivedSlug, step);
    const productDecision = await observe("product-material", holder, step);
    const after = accessScenarioTable.transitions["guide-archived"].after;
    expect([verdict("guide-archived:programme", after.programme, archivedProgramme), verdict("guide-archived:product-material", after["product-material"], productDecision)]
      .filter(entry => entry !== null)).toEqual([]);
  });
});
