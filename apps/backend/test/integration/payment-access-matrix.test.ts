import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { accountId as checkedAccountId, assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants, assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { BillingNotices, BillingOperations, BillingPayments, BillingPricing, BillingSubscriptions } from "../../src/modules/billing/index.js";
import type { OwnerOutcome, OwnerResult } from "../../src/modules/billing/domain/owner-operations.js";
import { tbankConfigSchema } from "../../src/config/tbank-config.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleGuideArtifactDelivery, assembleGuideArtifactResourceFacts, assembleGuideArtifacts, assembleMaterials, assembleMaterialResourceFacts, materialId as checkedMaterialId, type MaterialId } from "../../src/modules/materials/index.js";
import { assembleAssetResourceFacts } from "../../src/modules/materials/adapters/content-access/asset-resource-facts.js";
import { assembleVideoResourceFacts } from "../../src/modules/materials/adapters/content-access/video-resource-facts.js";
import { assembleMaterialAssetDelivery } from "../../src/modules/materials/features/deliver-material-asset/deliver-material-asset.js";
import { assembleVideoPlayback } from "../../src/modules/materials/facets/video-playback/video-playback.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { createTestVideoProvider } from "../../src/modules/videos/adapters/kinescope/test-video-provider.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { discoverPublishedMaterials } from "../../src/modules/content-library/index.js";
import type { ObjectStorage, StoredObject } from "../../src/infrastructure/object-storage/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { BankFixture } from "./setup/bank.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
import { syntheticConsentDocuments } from "./setup/consent-documents.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
}
/** Владельческий результат читается по объявленному виду, а не по форме поля. */
function success(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code);
  return result.result;
}
function asGrantPreview(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grantPreview") throw new Error(`Unexpected outcome ${value.outcome}`); return value;
}
function asGrantBatch(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grantBatch") throw new Error(`Unexpected outcome ${value.outcome}`); return value;
}
function asRefundDecision(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "refundDecision") throw new Error(`Unexpected outcome ${value.outcome}`); return value.value;
}
const config = tbankConfigSchema.parse({ environment: "demo", terminalKey: "SYNTHETICMATRIX", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 61).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  cardBinding: { confirmed: true, checkType: "3DS" }, minimumKopecks: 100, maximumKopecks: 10_000_000,
  returnUrl: "https://inside.example.test/account", notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" } });
const documents = syntheticConsentDocuments;
const guidePriceKopecks = 290_000;
const subscriptionPriceKopecks = 100_000;
const startedAt = "2030-01-31T10:00:00Z";
// Подписка куплена 31 января: её оплаченный срок заканчивается в последний день февраля.
const subscriptionEndsAt = "2030-02-28T10:00:00.000Z";

/**
 * Одна проверяемая матрица трёх связанных слоёв: оплата, выдача прав и проверка доступа.
 * Деньги и права проходят настоящий путь на реальном PostgreSQL; внешним остаётся только
 * двойник банка. Каждый пункт матрицы ломается отдельной проверкой этого файла.
 */
describe("оплата, выдача прав и доступ к материалам (реальный PostgreSQL, синтетический банк)", () => {
  let db: TestDatabase;
  let now = new Date(startedAt);
  let owner: string;
  let pricing: BillingPricing;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let materials: ReturnType<typeof assembleMaterials>;
  let contact: BillingContact;
  let accounts: ReturnType<typeof assembleAccounts>;
  const codes = new Map<string, string>();
  const objects = new Map<string, StoredObject>();
  const storage: ObjectStorage = {
    putImmutable: input => { objects.set(`${input.namespace}:${input.key}`, { body: input.body, checksumSha256: input.checksumSha256, contentLength: input.body.length, contentType: input.contentType }); return Promise.resolve({ ok: true }); },
    read: (namespace, key) => Promise.resolve(objects.get(`${namespace}:${key}`) ?? null),
    delete: (namespace, key) => { objects.delete(`${namespace}:${key}`); return Promise.resolve(); },
    signGet: input => Promise.resolve(`https://storage.example.test/${input.key}?ttl=${String(input.ttlSeconds)}`),
  };
  let guideA: string, guideB: string, guideSlug: string, topicId: string;
  let freeMaterial: MaterialId, libraryMaterial: MaterialId, guideMaterial: MaterialId, sharedMaterial: MaterialId, otherGuideMaterial: MaterialId;
  let chapterId: string;
  /** Один закрытый ресурс каждого вида: файл в теле, первичное видео и артефакт руководства. */
  let guideResources: { readonly assetId: string; readonly videoId: string; readonly providerVideoId: string; readonly artifactId: string };
  let access: ReturnType<typeof assembleContentAccess>;
  let delivery: ReturnType<typeof assembleMaterialAssetDelivery>;
  let artifacts: ReturnType<typeof assembleGuideArtifactDelivery>;
  let playback: ReturnType<typeof assembleVideoPlayback>;
  let videos: ReturnType<typeof assembleVideos>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
    await db.prisma.account.create({ data: { id: owner, logtoIssuer: "https://identity.example.test", logtoSubject: owner } });
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-matrix-fingerprint-key-00000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    membership = assembleMembershipEntitlements({ prisma: db.prisma, clock: () => now, workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma, clock: () => now }) });
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
    contact = new BillingContact({ prisma: db.prisma, protection: billingContactProtection(Buffer.alloc(32, 62).toString("base64")),
      documents, now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
    materials = assembleMaterials({ prisma: db.prisma, authorPolicy: { canManage: id => id === owner } });
    topicId = randomUUID();
    await db.prisma.topic.create({ data: { id: topicId, slug: "matrix-topic", name: "Синтетическая тема" } });

    guideSlug = `matrix-guide-${randomUUID()}`;
    guideA = await guide(guideSlug);
    guideB = await guide(`matrix-other-${randomUUID()}`);
    [freeMaterial, libraryMaterial, guideMaterial, sharedMaterial, otherGuideMaterial] = await Promise.all([
      material([], "free"), material([]), material([guideA]), material([guideA, guideB]), material([guideB]),
    ]);
    chapterId = await chapter(guideA, [guideMaterial, sharedMaterial]);

    const assets = assembleMaterialAssets({ prisma: db.prisma, objectStorage: storage });
    videos = assembleVideos({ prisma: db.prisma, provider: createTestVideoProvider(), projects: { free: "free", membership: "members" }, canManage: () => Promise.resolve(false), clock: () => now });
    const bytes = new TextEncoder().encode("Синтетический файл руководства");
    const uploaded = await assets.upload({ actor: owner, materialId: guideMaterial, body: bytes, declaredContentType: "text/plain", declaredSize: bytes.length,
      expectedChecksumSha256: createHash("sha256").update(bytes).digest("hex"), filename: "guide-file.txt", idempotencyKey: randomUUID(), kind: "file" });
    if (!uploaded.ok) throw new Error(uploaded.error.code);
    const videoId = randomUUID(), providerVideoId = randomUUID();
    await db.prisma.video.create({ data: { id: videoId, materialId: guideMaterial, createdBy: owner, access: "membership", projectId: "members",
      providerVideoId, title: "Синтетическое видео руководства", origin: "platform_upload", providerStatus: "done", state: "ready",
      readyAt: now, providerVisibleAt: now, providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`, durationSeconds: 60 } });
    await db.prisma.material.update({ where: { id: guideMaterial }, data: { primaryVideoId: videoId,
      body: { type: "doc", content: [{ type: "assetFile", attrs: { nodeId: randomUUID(), assetId: uploaded.value.assetId, label: "Файл руководства" } }] } } });

    const guideArtifacts = assembleGuideArtifacts({ prisma: db.prisma, objectStorage: storage, authorPolicy: { canManage: id => id === owner } });
    const artifactBody = new TextEncoder().encode("# Синтетический артефакт\n");
    const created = await guideArtifacts.create({ actor: owner, guideId: guideA, kind: "file",
      metadata: { access: "membership", purpose: "Проверка доступа матрицы", title: "Закрытый артефакт" },
      file: { body: artifactBody, declaredContentType: "text/markdown", declaredSize: artifactBody.byteLength,
        expectedChecksumSha256: createHash("sha256").update(artifactBody).digest("hex"), filename: "matrix-artifact.md" } });
    if (!created.ok) throw new Error(created.error.code);
    guideResources = { assetId: uploaded.value.assetId, videoId, providerVideoId, artifactId: created.value.artifactId };

    access = assembleContentAccess({ materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent),
      assetResourceFacts: assembleAssetResourceFacts(assets), videoResourceFacts: assembleVideoResourceFacts(videos),
      guideArtifactResourceFacts: assembleGuideArtifactResourceFacts(guideArtifacts),
      accountPermissions: { hasMaterialsManage: id => Promise.resolve(id === owner) }, membershipEntitlements: membership });
    artifacts = assembleGuideArtifactDelivery({ artifacts: guideArtifacts, contentAccess: access, objectStorage: storage, signedGetTtlSeconds: 60 });
    delivery = assembleMaterialAssetDelivery({ assets, contentAccess: access, materialContent: materials.materialContent, objectStorage: storage, signedGetTtlSeconds: 60 });
    playback = assembleVideoPlayback({ contentAccess: access, videos, jwtSecret: "synthetic-matrix-playback-key-508", jwtTtlSeconds: 60, clock: () => now });
  });
  afterAll(async () => db.dispose());

  async function guide(slug: string): Promise<string> {
    const created = await materials.authoring.createContentCollection({ actor: owner, kind: "guide", name: slug, slug, summary: "" });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }
  /** Опубликованный материал нужного состава: доступ к нему решает только матрица прав. */
  async function material(guideIds: readonly string[], accessClass: "free" | "membership" = "membership"): Promise<MaterialId> {
    const title = `Материал ${randomUUID()}`;
    const metadata = { title, summary: "Синтетическое описание матрицы доступа", access: accessClass, topicId,
      formatId: "guide", tagIds: [], seriesIds: [...guideIds] };
    const created = await materials.authoring.createDraft({ actor: owner, idempotencyKey: randomUUID(), metadata, body: representativeDocument(title) });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({ actor: owner, idempotencyKey: randomUUID(), materialId: created.value.materialId,
      expectedContentVersion: 1, publicationState: "published", metadata, body: representativeDocument(title) });
    if (!published.ok) throw new Error(published.error.code);
    return checkedMaterialId(created.value.materialId);
  }
  /** Одна глава руководства: она остаётся видимой и тогда, когда её материалы закрыты. */
  async function chapter(guideId: string, ordered: readonly MaterialId[]): Promise<string> {
    const loaded = await materials.authoring.loadSeriesOrder({ actor: owner, seriesId: guideId });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const id = randomUUID();
    const saved = await materials.authoring.reorderSeries({ actor: owner, seriesId: guideId, expectedOrderVersion: loaded.value.orderVersion,
      orderedMaterialIds: [...ordered], chapters: [{ id, name: "Первая глава", summary: "" }],
      chapterAssignments: Object.fromEntries(ordered.map(value => [value, id])) });
    if (!saved.ok) throw new Error(saved.error.code);
    return id;
  }

  /**
   * Продление и восстановление обходят всю базу файла, поэтому сценарий, который их запускает,
   * начинает с закрытия чужих расписаний и незавершённых попыток. Тот же приём в `scenario()`
   * набора `billing-subscriptions`.
   */
  async function ownSweeps(): Promise<void> {
    for (const stale of await db.prisma.billingSubscription.findMany({ where: { state: { not: "ended" } } }))
      await db.prisma.billingSubscription.update({ where: { id: stale.id }, data: { state: "ended", revision: stale.revision + 1, updatedAt: now } });
    await db.prisma.billingPurchase.updateMany({ where: { state: { in: ["prepared", "sent", "unknown", "pending", "authorized"] } },
      data: { state: "failed", lifecycleActive: false } });
    await db.prisma.billingPurchase.updateMany({ where: { kind: "initial", lifecycleActive: true }, data: { lifecycleActive: false } });
  }

  /** Покупатель с подтверждённым контактом: дальше он платит настоящим путём. */
  async function buyer(): Promise<string> {
    const id = randomUUID();
    await db.prisma.account.create({ data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id } });
    expect(await grants.classifyLegacy(owner, { operationId: randomUUID(), accountId: id, expectedRevision: 0, classification: "confirmed_new",
      sourceRef: id, reason: "Synthetic new buyer", bridgeEnabled: false, tributeStopped: false })).toMatchObject({ ok: true });
    const start = await contact.start(id, { operationId: randomUUID(), email: `${id}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    expect(await contact.confirm(id, { operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef) })).toMatchObject({ ok: true });
    return id;
  }
  /** Предложение владельца: подписка на библиотеку либо разовая цена одного руководства. */
  async function offer(input: { readonly name: string; readonly benefits: readonly string[]; readonly mode?: "one_time";
    readonly priceKopecks: number; readonly benefitPeriods?: readonly { capability: string; months: number | null }[] }) {
    const offerId = randomUUID(), optionId = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: { id: offerId, name: input.name,
      benefits: [...input.benefits], ...(input.benefitPeriods ? { benefitPeriods: [...input.benefitPeriods] } : {}) } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", value: { id: optionId, offerId,
      ...(input.mode ? { mode: input.mode } : {}), months: 1, priceKopecks: input.priceKopecks } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));
    return { offerId, optionId };
  }
  function guideOffer() {
    return offer({ name: "Руководство «Синтетика»", benefits: [`guide:${guideA}`], mode: "one_time", priceKopecks: guidePriceKopecks,
      benefitPeriods: [{ capability: `guide:${guideA}`, months: null }] });
  }
  function subscriptionOffer() {
    return offer({ name: "Материалы", benefits: ["materials"], priceKopecks: subscriptionPriceKopecks });
  }
  /** Старший тариф: общий чат объявлен прямо в его составе. */
  function seniorOffer() {
    return offer({ name: "Материалы и сообщество", benefits: ["materials", "community"], priceKopecks: subscriptionPriceKopecks });
  }
  /** Действующие права Account: ровно тот состав, из которого собирается желаемое состояние чата. */
  async function capabilities(account: string) {
    const resolved = await grants.resolveCapabilities(account);
    if (!resolved.ok) throw new Error(resolved.error.code);
    return resolved.capabilities;
  }
  /** Одно действующее основание с этим правом: его владелец и снимает. */
  async function revokeGround(account: string, capability: string) {
    const row = await db.prisma.accessGrant.findFirstOrThrow({
      where: { accountId: account, revokedAt: null, capabilities: { has: capability } } });
    expect(await grants.changeGrant(owner, { action: "revoke", operationId: randomUUID(), grantRef: row.id,
      expectedRevision: row.revision, reason: `Синтетический отзыв основания ${capability}` })).toMatchObject({ ok: true });
  }
  /** Независимое бессрочное право на второе руководство, выданное владельцем, а не оплатой. */
  async function manualGuideGrant(operations: BillingOperations, account: string, guideId: string) {
    const preview = asGrantPreview(await operations.execute(owner, { operation: "grants.previewBatch", operationId: randomUUID(),
      rows: [{ rowKey: "guide", accountId: account, source: "manual", sourceRef: randomUUID(),
        terms: { capabilities: [`guide:${guideId}`], startsAt: startedAt, validUntil: null, reason: "Синтетическая выдача руководства" } }] }));
    expect(asGrantBatch(await operations.execute(owner, { operation: "grants.applyBatch", operationId: randomUUID(),
      previewRef: preview.previewRef, expectedRevision: preview.revision, confirmedRows: ["guide"] })).rows).toHaveLength(1);
  }
  /** Подтверждённый возврат с отзывом оплаченного основания: деньги и права решаются вместе. */
  async function refundWithRevoke(operations: BillingOperations, purchaseRef: string, amountKopecks: number,
    recurring: "keep" | "cancel" = "keep") {
    const decided = asRefundDecision(await operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(),
      purchaseRef, amountKopecks, access: "revoke", recurring, reason: "Синтетический возврат с отзывом доступа" }));
    expect(asRefundDecision(await operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: decided.decisionRef, expectedRevision: 1 }))).toMatchObject({ state: "executed", attempt: { state: "confirmed" } });
  }

  /** Один платёжный стенд: свой банк, свои платежи и своё продление. */
  function billingStand() {
    const bank = new BankFixture(config);
    const client = bank.client();
    const payments = new BillingPayments({ prisma: db.prisma, bank: client, contact, grants, clock: () => now });
    const subscriptions = new BillingSubscriptions({ prisma: db.prisma, bank: client, contact, grants, payments,
      notices: new BillingNotices({ prisma: db.prisma, clock: () => now }), clock: () => now });
    const operations = new BillingOperations({ prisma: db.prisma, accounts, pricing, payments, subscriptions, grants, bank: client, clock: () => now });
    return { bank, payments, subscriptions, operations };
  }
  /** Расчёт и согласия одной покупки: подписка принимает списания, разовая — только оферту. */
  async function command(account: string, optionId: string, options: { readonly recurring?: boolean } = {}) {
    const quote = value(await pricing.quote(account, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
    const accepted = await contact.acceptConsents(account, { operationId: randomUUID(), contextRef: quote.quoteRef,
      documents: documents.filter(document => options.recurring === true || document.kind === "terms")
        .map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
    if (!accepted.ok) throw new Error(accepted.error.code);
    return { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
      consentEvidenceRefs: accepted.evidenceRefs, acknowledgeExistingAccess: false };
  }
  /** Путь покупки целиком: расчёт, согласия, команда и ответ банка без выдачи прав. */
  async function purchase(payments: BillingPayments, account: string, optionId: string, options: { readonly recurring?: boolean } = {}) {
    return payments.purchase(account, await command(account, optionId, options));
  }

  const context = { enforcementPoint: "published_material_read" as const, correlationId: randomUUID() };
  const guest = { kind: "anonymous" as const };
  const reader = (account: string) => ({ kind: "account" as const, accountId: checkedAccountId(account) });
  function decide(subject: { kind: "anonymous" } | { kind: "account"; accountId: ReturnType<typeof checkedAccountId> }, id: MaterialId) {
    return access.authorize({ ...context, subject, action: "read", resource: { kind: "material", materialId: id } });
  }
  /** Программа руководства глазами читателя: главы видны, а материалы — по праву. */
  async function guideProgramme(subject: { kind: "anonymous" } | { kind: "account"; accountId: ReturnType<typeof checkedAccountId> }) {
    const discovered = await discoverPublishedMaterials(materials.publishedMaterialReader, access, videos,
      { first: null, kind: "series", slug: guideSlug, subject });
    return value(discovered);
  }

  test("путь покупки руководства открывает ровно его материалы, файлы, видео и артефакты", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const account = await buyer();
    const { optionId } = await guideOffer();
    const { bank, payments } = billingStand();

    // До оплаты руководство закрыто, а его глава остаётся видимой витриной программы.
    expect(await decide(reader(account), guideMaterial)).toMatchObject({ effect: "deny", reason: "membership_required" });
    expect(await delivery.deliver({ materialId: guideMaterial, assetId: guideResources.assetId, contentVersion: 2, preview: false, subject: reader(account) }))
      .toMatchObject({ ok: false, error: { code: "asset_not_found" } });
    expect(await playback.createSession({ materialId: guideMaterial, videoId: guideResources.videoId, subject: reader(account), correlationId: randomUUID() }))
      .toMatchObject({ ok: false, error: { code: "access_denied" } });
    expect(await artifacts.deliver({ artifactId: guideResources.artifactId, guideId: guideA, preview: false, subject: reader(account), version: 1 }))
      .toMatchObject({ ok: false, error: { code: "artifact_not_found" } });
    // Описание главы доходит до читателя вместе с программой; у этой главы его просто нет.
    const chapters = [{ id: chapterId, materialIds: [guideMaterial, sharedMaterial], name: "Первая глава", summary: "" }];
    const before = await guideProgramme(reader(account));
    expect(before.chapters).toEqual(chapters);
    expect(before.items.map(item => item.availability)).toEqual(["locked", "locked"]);

    const bought = value(await purchase(payments, account, optionId));
    expect(bought.access).toBe("awaiting_payment");
    expect(await db.prisma.accessGrant.count({ where: { accountId: account } })).toBe(0);
    expect(await payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
    value(await payments.recover());
    expect(value(await payments.status(account, bought.purchaseRef))).toMatchObject({ state: "confirmed", access: "ready", periodEndsAt: null });

    // Одна оплата — одно бессрочное право ровно на купленное руководство.
    const granted = await db.prisma.accessGrant.findMany({ where: { accountId: account } });
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ source: "paid", capabilities: [`guide:${guideA}`], validUntil: null });
    expect(bank.initCalls).toBe(1);

    for (const id of [guideMaterial, sharedMaterial]) expect(await decide(reader(account), id)).toMatchObject({ effect: "allow", reason: "active_membership", validUntil: null });
    // Прямой адрес чужого руководства и библиотечного материала остаётся закрытым.
    for (const id of [libraryMaterial, otherGuideMaterial]) expect(await decide(reader(account), id)).toMatchObject({ effect: "deny", reason: "membership_required" });
    expect(await decide(reader(account), freeMaterial)).toMatchObject({ effect: "allow", reason: "public_resource" });

    const subject = reader(account);
    expect(await delivery.deliver({ materialId: guideMaterial, assetId: guideResources.assetId, contentVersion: 2, preview: false, subject })).toMatchObject({ ok: true, value: { kind: "redirect" } });
    const session = await playback.createSession({ materialId: guideMaterial, videoId: guideResources.videoId, subject, correlationId: randomUUID() });
    if (!session.ok || !session.value.drmAuthToken) throw new Error("Expected a protected playback token");
    expect(await playback.authorizeProvider({ providerVideoId: guideResources.providerVideoId, token: session.value.drmAuthToken })).toBe(true);

    // Файлы, видео и артефакты руководства открываются тем же правом, что и его материалы.
    expect(await artifacts.deliver({ artifactId: guideResources.artifactId, guideId: guideA, preview: false, subject, version: 1 }))
      .toMatchObject({ ok: true, value: { kind: "redirect", cacheScope: "private-no-store" } });
    const after = await guideProgramme(reader(account));
    expect(after.chapters).toEqual(chapters);
    expect(after.items.map(item => item.availability)).toEqual(["available", "available"]);
  });

  test("гость, участник, покупатель руководства и истёкшие права видят ровно своё", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const [memberAccount, guideBuyer, lapsedMember, lapsedGuideBuyer] = await Promise.all([buyer(), buyer(), buyer(), buyer()]);
    const subscription = await subscriptionOffer();
    const bought = await guideOffer();
    const { bank, payments } = billingStand();
    async function paid(account: string, optionId: string, options: { readonly recurring?: boolean } = {}) {
      const bought = value(await purchase(payments, account, optionId, options));
      if (options.recurring === true) expect(await payments.notification(bank.notify(bought.purchaseRef, "AUTHORIZED", { RebillId: "synthetic-card" }))).toMatchObject({ ok: true });
      expect(await payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
      value(await payments.recover());
    }
    await paid(memberAccount, subscription.optionId, { recurring: true });
    await paid(guideBuyer, bought.optionId);
    await paid(lapsedMember, subscription.optionId, { recurring: true });
    await paid(lapsedGuideBuyer, subscription.optionId, { recurring: true });
    await paid(lapsedGuideBuyer, bought.optionId);

    // Свободный материал открыт всем, включая гостя; закрытый требует доказанного основания.
    expect(await decide(guest, freeMaterial)).toMatchObject({ effect: "allow", reason: "public_resource" });
    for (const id of [libraryMaterial, guideMaterial, sharedMaterial])
      expect(await decide(guest, id)).toMatchObject({ effect: "deny", reason: "authentication_required" });
    for (const id of [libraryMaterial, guideMaterial, sharedMaterial, otherGuideMaterial])
      expect(await decide(reader(memberAccount), id)).toMatchObject({ effect: "allow", reason: "active_membership", validUntil: subscriptionEndsAt });
    expect(await decide(reader(guideBuyer), guideMaterial)).toMatchObject({ effect: "allow", reason: "active_membership", validUntil: null });
    for (const id of [libraryMaterial, otherGuideMaterial])
      expect(await decide(reader(guideBuyer), id)).toMatchObject({ effect: "deny", reason: "membership_required" });

    // Оплаченный срок закончился: подписка закрывается, а купленное руководство остаётся.
    now = new Date("2030-03-01T10:00:00Z");
    for (const id of [libraryMaterial, guideMaterial, otherGuideMaterial])
      expect(await decide(reader(lapsedMember), id)).toMatchObject({ effect: "deny", reason: "membership_expired" });
    expect(await decide(reader(lapsedMember), freeMaterial)).toMatchObject({ effect: "allow", reason: "public_resource" });
    for (const id of [guideMaterial, sharedMaterial])
      expect(await decide(reader(lapsedGuideBuyer), id)).toMatchObject({ effect: "allow", reason: "active_membership", validUntil: null });
    for (const id of [libraryMaterial, otherGuideMaterial])
      expect(await decide(reader(lapsedGuideBuyer), id)).toMatchObject({ effect: "deny", reason: "membership_expired" });
    expect(await guideProgramme(reader(lapsedGuideBuyer))).toMatchObject({ items: [{ availability: "available" }, { availability: "available" }] });
  });

  test("повтор и опоздание платёжного события не создают второго права и второго списания", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const account = await buyer();
    const { optionId } = await guideOffer();
    const { bank, payments } = billingStand();
    const purchaseCommand = await command(account, optionId);
    const bought = value(await payments.purchase(account, purchaseCommand));
    // Та же команда из второй вкладки возвращает исходную покупку, а не вторую попытку.
    expect(value(await payments.purchase(account, purchaseCommand)).purchaseRef).toBe(bought.purchaseRef);
    const repeated = await Promise.all(Array.from({ length: 6 }, () => payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED"))));
    expect(repeated.every(result => result.ok)).toBe(true);
    expect(await db.prisma.billingPaymentEvent.count({ where: { purchaseRef: bought.purchaseRef } })).toBe(1);
    value(await payments.recover());
    const granted = await db.prisma.accessGrant.findMany({ where: { accountId: account } });
    expect(granted).toHaveLength(1);
    expect(granted[0]?.startsAt.toISOString()).toBe("2030-01-31T10:00:00.000Z");

    // Опоздавшее уведомление и поздняя сверка приходят неделей позже и ничего не переписывают.
    now = new Date("2030-02-07T10:00:00Z");
    const late = await Promise.all([payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED")), payments.reconcile(bought.purchaseRef), payments.recover()]);
    expect(late.every(result => result.ok)).toBe(true);
    expect(value(await payments.status(account, bought.purchaseRef))).toMatchObject({ state: "confirmed", access: "ready" });
    expect(await db.prisma.accessGrant.findMany({ where: { accountId: account } })).toMatchObject([{ startsAt: new Date("2030-01-31T10:00:00Z"), validUntil: null }]);
    expect(await db.prisma.billingPurchase.count({ where: { accountId: account } })).toBe(1);
    expect(bank.initCalls).toBe(1);
    expect(await decide(reader(account), guideMaterial)).toMatchObject({ effect: "allow", reason: "active_membership", validUntil: null });
  });

  test("отказ и неизвестный ответ банка не открывают доступ и не выдаются за успех", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const [refused, silent] = await Promise.all([buyer(), buyer()]);
    const { optionId } = await guideOffer();
    const { bank, payments } = billingStand();
    const rejected = value(await purchase(payments, refused, optionId));
    expect(await payments.notification(bank.notify(rejected.purchaseRef, "REJECTED"))).toMatchObject({ ok: true });
    expect(value(await payments.status(refused, rejected.purchaseRef))).toMatchObject({ state: "failed", access: "awaiting_payment" });
    expect(await db.prisma.accessGrant.count({ where: { accountId: refused } })).toBe(0);
    expect(await decide(reader(refused), guideMaterial)).toMatchObject({ effect: "deny", reason: "membership_required" });

    // Банк принял запрос и замолчал: исход неизвестен, повтор запрещён, доступа нет.
    bank.failInit = true;
    const pending = await command(silent, optionId);
    const unknown = value(await payments.purchase(silent, pending));
    expect(unknown).toMatchObject({ state: "unknown", access: "awaiting_payment" });
    expect(value(await payments.purchase(silent, pending)).purchaseRef).toBe(unknown.purchaseRef);
    expect(bank.initCalls).toBe(2);
    value(await payments.recover());
    expect(await db.prisma.accessGrant.count({ where: { accountId: silent } })).toBe(0);
    expect(await decide(reader(silent), guideMaterial)).toMatchObject({ effect: "deny", reason: "membership_required" });

    // Тот же платёж, сверенный после ответа банка, выдаёт право один раз.
    bank.failInit = false;
    bank.settle(unknown.purchaseRef, "CONFIRMED");
    expect(await payments.reconcile(unknown.purchaseRef)).toMatchObject({ ok: true });
    value(await payments.recover());
    expect(bank.initCalls).toBe(2);
    expect(await db.prisma.accessGrant.count({ where: { accountId: silent } })).toBe(1);
    expect(await decide(reader(silent), guideMaterial)).toMatchObject({ effect: "allow", reason: "active_membership", validUntil: null });
  });

  test("выключение и архивирование продажи не трогают действующий доступ и продление", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const account = await buyer();
    const { offerId, optionId } = await subscriptionOffer();
    const { bank, payments, subscriptions } = billingStand();
    const bought = value(await purchase(payments, account, optionId, { recurring: true }));
    expect(await payments.notification(bank.notify(bought.purchaseRef, "AUTHORIZED", { RebillId: "synthetic-card" }))).toMatchObject({ ok: true });
    expect(await payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
    value(await payments.recover());
    expect(await decide(reader(account), libraryMaterial)).toMatchObject({ effect: "allow", validUntil: subscriptionEndsAt });

    // Пока вариант в продаже, витрина его показывает; после выключения — нет.
    expect(value(await pricing.offers({ mode: "subscription" })).items.some(item => item.offer.id === offerId)).toBe(true);
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.unpublish", expectedRevision: 2, id: offerId }));
    expect(value(await pricing.offers({ mode: "subscription" })).items.some(item => item.offer.id === offerId)).toBe(false);

    // Принятые условия продолжают действовать: срок продлевается, доступ не прерывается.
    now = new Date("2030-02-28T10:00:00Z");
    value(await payments.renew());
    value(await payments.recover());
    expect(value(await subscriptions.read(account)).subscription).toMatchObject({ state: "active", periodIndex: 2, paidUntil: "2030-03-31T10:00:00.000Z" });
    // Продлилась ровно эта подписка: у стенда одно списание и ни одной чужой отправки.
    expect(bank.chargeCalls).toBe(1);
    expect(await decide(reader(account), libraryMaterial)).toMatchObject({ effect: "allow", validUntil: "2030-03-31T10:00:00.000Z" });

    // Архивирование снимает предложение окончательно и тоже не переписывает уже выданное право.
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.archive", expectedRevision: 3, id: offerId }));
    const paid = await db.prisma.accessGrant.findMany({ where: { accountId: account, source: "paid" }, orderBy: { startsAt: "asc" } });
    expect(paid.at(-1)).toMatchObject({ capabilities: ["materials"], revokedAt: null, validUntil: new Date("2030-03-31T10:00:00Z") });
    expect(await decide(reader(account), libraryMaterial)).toMatchObject({ effect: "allow", validUntil: "2030-03-31T10:00:00.000Z" });
  });

  test("выдача владельческой операцией открывает доступ, но не выдаётся за покупку", async () => {
    now = new Date(startedAt);
    const account = await buyer();
    const { payments, subscriptions, operations } = billingStand();
    const sourceRef = randomUUID();
    const preview = asGrantPreview(await operations.execute(owner, { operation: "grants.previewBatch", operationId: randomUUID(),
      rows: [{ rowKey: "matrix", accountId: account, source: "manual", sourceRef,
        terms: { capabilities: ["materials"], startsAt: startedAt, validUntil: null, reason: "Синтетическая выдача через API" } }] }));
    expect(asGrantBatch(await operations.execute(owner, { operation: "grants.applyBatch", operationId: randomUUID(),
      previewRef: preview.previewRef, expectedRevision: preview.revision, confirmedRows: ["matrix"] })).rows).toHaveLength(1);
    expect(await decide(reader(account), libraryMaterial)).toMatchObject({ effect: "allow", validUntil: null });

    // Открытое право не становится оплатой: ни платежа, ни подписки, ни чека.
    expect(value(await payments.history(account))).toEqual([]);
    expect(await db.prisma.billingPurchase.count({ where: { accountId: account } })).toBe(0);
    expect(await db.prisma.billingSubscription.count({ where: { accountId: account } })).toBe(0);
    expect(value(await subscriptions.read(account))).toMatchObject({ subscription: null, payments: [],
      grounds: [{ source: "manual", capabilities: ["materials"], startsAt: "2030-01-31T10:00:00.000Z", validUntil: null, active: true }] });
  });

  /**
   * Общий чат открывает не название тарифа, а любое действующее право: и состав старшей подписки,
   * и купленное руководство. Решение владельца от 12.09.2026: срок участия равен сроку права.
   */
  test("купленное руководство открывает общий чат и держит его дольше истёкшей подписки", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const [onlyGuide, withBoth] = await Promise.all([buyer(), buyer()]);
    const senior = await seniorOffer();
    const bought = await guideOffer();
    const { bank, payments, subscriptions } = billingStand();
    async function pay(account: string, optionId: string, options: { readonly recurring?: boolean } = {}) {
      const purchased = value(await purchase(payments, account, optionId, options));
      if (options.recurring === true) expect(await payments.notification(bank.notify(purchased.purchaseRef, "AUTHORIZED", { RebillId: "synthetic-card" }))).toMatchObject({ ok: true });
      expect(await payments.notification(bank.notify(purchased.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
      value(await payments.recover());
      return purchased.purchaseRef;
    }

    // До покупки оснований нет: ни подписки, ни права на руководство, ни чата.
    expect(await capabilities(onlyGuide)).toEqual([]);
    await pay(onlyGuide, bought.optionId);
    // Одна разовая покупка: право бессрочное, и участие в чате живёт ровно его сроком.
    expect(await capabilities(onlyGuide)).toEqual([
      { capability: "community", validUntil: null },
      { capability: `guide:${guideA}`, validUntil: null },
    ]);
    // Кабинет показывает ровно одно оплаченное основание: чат выводится из него, а не из тарифа.
    expect(value(await subscriptions.read(onlyGuide))).toMatchObject({ subscription: null,
      grounds: [{ source: "paid", capabilities: [`guide:${guideA}`], validUntil: null, active: true }] });
    // Проверка доступа к материалам не изменилась: чужая библиотека руководством не открывается.
    expect(await decide(reader(onlyGuide), libraryMaterial)).toMatchObject({ effect: "deny", reason: "membership_required" });

    await pay(withBoth, senior.optionId, { recurring: true });
    await pay(withBoth, bought.optionId);
    // Два основания сразу: бессрочное право на руководство перекрывает срок подписки.
    expect(await capabilities(withBoth)).toEqual([
      { capability: "community", validUntil: null },
      { capability: `guide:${guideA}`, validUntil: null },
      { capability: "materials", validUntil: subscriptionEndsAt },
    ]);

    now = new Date("2030-03-01T10:00:00Z");
    // Оплаченный срок подписки закончился, а чат остался: его держит купленное руководство.
    expect(await capabilities(withBoth)).toEqual([
      { capability: "community", validUntil: null },
      { capability: `guide:${guideA}`, validUntil: null },
    ]);
    expect(await decide(reader(withBoth), libraryMaterial)).toMatchObject({ effect: "deny", reason: "membership_expired" });
  });

  test("чат держится, пока есть хоть одно основание, и снимается вместе с последним", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const [withBoth, refunded, kept] = await Promise.all([buyer(), buyer(), buyer()]);
    const senior = await seniorOffer();
    const bought = await guideOffer();
    const { bank, payments, operations } = billingStand();
    async function pay(account: string, optionId: string, options: { readonly recurring?: boolean } = {}) {
      const purchased = value(await purchase(payments, account, optionId, options));
      if (options.recurring === true) expect(await payments.notification(bank.notify(purchased.purchaseRef, "AUTHORIZED", { RebillId: "synthetic-card" }))).toMatchObject({ ok: true });
      expect(await payments.notification(bank.notify(purchased.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
      value(await payments.recover());
      return purchased.purchaseRef;
    }

    const subscribed = await pay(withBoth, senior.optionId, { recurring: true });
    const guidePurchase = await pay(withBoth, bought.optionId);
    // Снятие одного основания не забирает чат: его продолжает держать состав подписки.
    await refundWithRevoke(operations, guidePurchase, guidePriceKopecks);
    value(await payments.recover());
    expect(await capabilities(withBoth)).toEqual([
      { capability: "community", validUntil: subscriptionEndsAt },
      { capability: "materials", validUntil: subscriptionEndsAt },
    ]);
    // Снятие последнего основания забирает и чат.
    await refundWithRevoke(operations, subscribed, subscriptionPriceKopecks, "cancel");
    value(await payments.recover());
    expect(await capabilities(withBoth)).toEqual([]);

    // Возврат покупки снимает доступ, когда другого основания нет.
    const refundedPurchase = await pay(refunded, bought.optionId);
    expect(await capabilities(refunded)).toContainEqual({ capability: "community", validUntil: null });
    await refundWithRevoke(operations, refundedPurchase, guidePriceKopecks);
    value(await payments.recover());
    expect(await capabilities(refunded)).toEqual([]);

    // Тот же возврат при независимом бессрочном праве оставляет чат открытым.
    const keptPurchase = await pay(kept, bought.optionId);
    await manualGuideGrant(operations, kept, guideB);
    await refundWithRevoke(operations, keptPurchase, guidePriceKopecks);
    value(await payments.recover());
    expect(await capabilities(kept)).toEqual([
      { capability: "community", validUntil: null },
      { capability: `guide:${guideB}`, validUntil: null },
    ]);
    // Ручное основание снимает владелец, и с последним основанием чат закрывается.
    await revokeGround(kept, `guide:${guideB}`);
    expect(await capabilities(kept)).toEqual([]);
  });

  /**
   * Право на руководство уже открывает чат, поэтому старший тариф пересекается с ним составом.
   * Покупатель об этом предупреждён и продолжает подтверждением, а не обходом проверки.
   */
  test("после покупки руководства старший тариф требует подтверждения пересечения состава", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const account = await buyer();
    const senior = await seniorOffer();
    const bought = await guideOffer();
    const { bank, payments } = billingStand();
    const purchased = value(await purchase(payments, account, bought.optionId));
    expect(await payments.notification(bank.notify(purchased.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
    value(await payments.recover());

    expect(await payments.purchase(account, await command(account, senior.optionId, { recurring: true })))
      .toMatchObject({ ok: false, error: { code: "existing_access" } });
    const acknowledged = value(await payments.purchase(account,
      { ...await command(account, senior.optionId, { recurring: true }), acknowledgeExistingAccess: true }));
    expect(await payments.notification(bank.notify(acknowledged.purchaseRef, "AUTHORIZED", { RebillId: "synthetic-card" }))).toMatchObject({ ok: true });
    expect(await payments.notification(bank.notify(acknowledged.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
    value(await payments.recover());
    // Бессрочное право на руководство переживает срок подписки и оставляет чат бессрочным.
    expect(await capabilities(account)).toEqual([
      { capability: "community", validUntil: null },
      { capability: `guide:${guideA}`, validUntil: null },
      { capability: "materials", validUntil: subscriptionEndsAt },
    ]);
  });
});
