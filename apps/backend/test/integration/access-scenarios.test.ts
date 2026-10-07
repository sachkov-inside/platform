import { sourceIdentityRef } from "../../src/modules/membership-entitlements/domain/source-identity.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  accountId as checkedAccountId,
  assembleAccounts,
  BillingContact,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
  TributeSources,
  type AccessCapability,
} from "../../src/modules/membership-entitlements/index.js";
import {
  BillingNotices,
  BillingOperations,
  BillingPayments,
  BillingPricing,
  BillingSubscriptions,
  SubscriptionActivation,
  TributeConvergence,
} from "../../src/modules/billing/index.js";
import type {
  OwnerOutcome,
  OwnerResult,
} from "../../src/modules/billing/domain/owner-operations.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  type ContentAccess,
  type Resource,
} from "../../src/modules/content-access/index.js";
import { discoverPublishedMaterials } from "../../src/modules/content-library/index.js";
import {
  assembleGuideArtifactResourceFacts,
  assembleGuideArtifacts,
  assembleMaterialResourceFacts,
  assembleMaterials,
  materialId as checkedMaterialId,
  type MaterialId,
} from "../../src/modules/materials/index.js";
import { assembleVideoResourceFacts } from "../../src/modules/materials/adapters/content-access/video-resource-facts.js";
import { assembleVideoPlayback } from "../../src/modules/materials/facets/video-playback/video-playback.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { createTestVideoProvider } from "../../src/modules/videos/adapters/kinescope/test-video-provider.js";
import {
  CommunityEntitlements,
  TelegramAccountLinks,
  type CommunitySetCommand,
} from "../../src/modules/telegram-membership/index.js";
import type {
  CommunityDeliveryOutcome,
  CommunityEntitlementProvider,
} from "../../src/modules/telegram-membership/ports/community-entitlement-provider.js";
import type {
  ObjectStorage,
  StoredObject,
} from "../../src/infrastructure/object-storage/index.js";
import { subscriptionPeriodEnd } from "../../src/modules/billing/domain/subscription-period.js";
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
  type OfferTerm,
  type OfferTerms,
} from "../access-scenarios/access-scenarios.js";
import {
  compareAccessObservation,
  type AccessObservation,
} from "../access-scenarios/check-access-scenarios.js";
import { BankFixture } from "./setup/bank.js";
import {
  pressedPaymentButton,
  syntheticConsentDocuments,
} from "./setup/consent-documents.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const config = syntheticTbankConfig({
  environment: "demo",
  terminalKey: "SYNTHETICSCENARIOS",
  password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 71).toString("base64"),
  recurringCardConfirmed: true,
  cardOnlyHostedConfirmed: true,
  cardBinding: { confirmed: true, checkType: "3DS" },
  minimumKopecks: 100,
  maximumKopecks: 10_000_000,
  returnUrl: "https://inside.example.test/account",
  notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" },
});
const startedAt = "2030-01-31T10:00:00.000Z";
/** Сопровождение из предложения продукта: ровно шесть календарных месяцев с оплаты. */
const supportEndsAt = "2030-07-31T10:00:00.000Z";
const groundEndsAt = "2030-03-02T10:00:00.000Z";
const guidePriceKopecks = 290_000;

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function owned(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code);
  return result.result;
}

interface Participant {
  readonly account: string;
  readonly identityRef: string;
  readonly principalRef: string;
}

/**
 * Исполнение таблицы сценариев доступа. Мир один на файл: продукт A с закрытым материалом, видео и
 * артефактом, предложение продукта с сопровождением, стартовый и скрытый тарифы. Каждое основание
 * получает свой Account настоящим путём — оплатой через синтетический банк, владельческой операцией,
 * реестром Tribute, прямым правом, возвратом, запретом в чате, — а каждая клетка читается через
 * публичный фасад и сравнивается с ожиданием таблицы одной функцией.
 */
describe("таблица сценариев доступа (реальный PostgreSQL, синтетический банк и Telegram)", () => {
  let db: TestDatabase;
  let now = new Date(startedAt);
  const owner = randomUUID();
  let accounts: ReturnType<typeof assembleAccounts>;
  let links: TelegramAccountLinks;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let pricing: BillingPricing;
  let contact: BillingContact;
  let operations: BillingOperations;
  let activation: SubscriptionActivation;
  let payments: BillingPayments;
  let convergence: TributeConvergence;
  let community: CommunityEntitlements;
  let bank: BankFixture;
  let materials: ReturnType<typeof assembleMaterials>;
  let guideArtifacts: ReturnType<typeof assembleGuideArtifacts>;
  let videos: ReturnType<typeof assembleVideos>;
  let playback: ReturnType<typeof assembleVideoPlayback>;
  let readerAccess: ContentAccess;
  let authorAccess: ContentAccess;
  const codes = new Map<string, string>();
  const purchases = new Map<string, string>();
  /** Telegram identity, которым в сценарии модератор запретил вход в чат. */
  const moderatedIdentities = new Set<string>();
  const objects = new Map<string, StoredObject>();
  const storage: ObjectStorage = {
    putImmutable: (input) => {
      objects.set(`${input.namespace}:${input.key}`, {
        body: input.body,
        checksumSha256: input.checksumSha256,
        contentLength: input.body.length,
        contentType: input.contentType,
      });
      return Promise.resolve({ ok: true });
    },
    read: (namespace, key) =>
      Promise.resolve(objects.get(`${namespace}:${key}`) ?? null),
    delete: (namespace, key) => {
      objects.delete(`${namespace}:${key}`);
      return Promise.resolve();
    },
    signGet: (input) =>
      Promise.resolve(
        `https://storage.example.test/${input.key}?ttl=${String(input.ttlSeconds)}`,
      ),
  };
  /** Бот Inside в сценарии: принимает команду и сообщает запрет модератора для выбранных identity. */
  const provider: CommunityEntitlementProvider = {
    set: (command) => Promise.resolve(providerOutcome(command)),
    status: (command) => Promise.resolve(providerOutcome(command)),
  };
  function providerOutcome(
    command: CommunitySetCommand,
  ): CommunityDeliveryOutcome {
    return {
      kind: "result",
      result: {
        contractVersion: command.contractVersion,
        operation: "entitlement.result",
        operationId: command.operationId,
        binding: command.binding,
        entitlementRevision: command.entitlementRevision,
        access: command.access,
        status: "accepted",
        observedMembership: "unknown",
        updatedAt: command.issuedAt,
        admissionRestriction: moderatedIdentities.has(
          command.binding.telegramIdentityRef,
        )
          ? "moderation"
          : "none",
      },
    };
  }
  let topicId: string;
  let guideA: string;
  let guideSlug: string;
  let freeMaterial: MaterialId;
  let productMaterial: MaterialId;
  let videoId: string;
  let providerVideoId: string;
  let artifactId: string;
  let productOptionId: string;
  let tierId: string;
  let tributeSubscription = 648_000;
  /** Account каждого основания; `null` — гость. Столбец может держать несколько случаев сразу. */
  const grounds = new Map<AccessGround, readonly (string | null)[]>();

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    await db.prisma.account.create({
      data: {
        id: owner,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: owner,
      },
    });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-scenarios-fingerprint-key-00",
    });
    links = new TelegramAccountLinks(db.prisma);
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: links,
      clock: () => now,
    });
    membership = assembleMembershipEntitlements({
      prisma: db.prisma,
      recipientLinks: links,
      clock: () => now,
    });
    // Tribute открывает тариф только через реестр источника: политика, строка реестра и сверка.
    convergence = new TributeConvergence(
      db.prisma,
      new TributeSources({
        prisma: db.prisma,
        accounts,
        links,
        clock: () => now,
      }),
    );
    community = new CommunityEntitlements({
      botStartUrl: "https://t.me/inside_test_bot",
      accounts,
      clock: () => now,
      grants,
      links,
      prisma: db.prisma,
      provider,
    });
    pricing = new BillingPricing({
      prisma: db.prisma,
      accounts,
      grants,
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
    contact = new BillingContact({
      prisma: db.prisma,
      protection: billingContactProtection(
        Buffer.alloc(32, 72).toString("base64"),
      ),
      documents: syntheticConsentDocuments,
      now: () => now,
      sendCode: (message) => {
        codes.set(message.challengeRef, message.code);
        return Promise.resolve();
      },
    });
    bank = new BankFixture(config);
    const client = bank.client();
    payments = new BillingPayments({
      prisma: db.prisma,
      bank: client,
      contact,
      grants,
      clock: () => now,
    });
    const subscriptions = new BillingSubscriptions({
      prisma: db.prisma,
      bank: client,
      contact,
      grants,
      payments,
      notices: new BillingNotices({
        prisma: db.prisma,
        enrollments: grants,
        clock: () => now,
      }),
      clock: () => now,
    });
    operations = new BillingOperations({
      prisma: db.prisma,
      accounts,
      pricing,
      payments,
      subscriptions,
      grants,
      bank: client,
      clock: () => now,
    });
    activation = new SubscriptionActivation({
      prisma: db.prisma,
      grants,
      bindings: links,
      readAdmission: () =>
        Promise.resolve({ state: "checking", admissionRestriction: null }),
      siteOrigin: "https://inside.example.test",
    });
    materials = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: (id) => id === owner },
      guideAccessHolders: grants,
    });
    videos = assembleVideos({
      prisma: db.prisma,
      provider: createTestVideoProvider(),
      projects: { free: "free", membership: "members" },
      canManage: () => Promise.resolve(false),
      clock: () => now,
    });
    guideArtifacts = assembleGuideArtifacts({
      prisma: db.prisma,
      objectStorage: storage,
      authorPolicy: { canManage: (id) => id === owner },
    });
    const resources = {
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      videoResourceFacts: assembleVideoResourceFacts(videos),
      guideArtifactResourceFacts:
        assembleGuideArtifactResourceFacts(guideArtifacts),
      membershipEntitlements: membership,
      clock: () => now,
    };
    // Читатель — Account без разрешения автора. Автор — тот же Account с `materials:manage` из базы.
    readerAccess = assembleContentAccess({
      ...resources,
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
    });
    authorAccess = assembleContentAccess({
      ...resources,
      accountPermissions: assembleCurrentAccountPermissions(accounts),
    });
    playback = assembleVideoPlayback({
      contentAccess: readerAccess,
      videos,
      jwtSecret: "synthetic-scenarios-playback-key-648",
      jwtTtlSeconds: 60,
      clock: () => now,
    });

    topicId = randomUUID();
    await db.prisma.topic.create({
      data: { id: topicId, slug: "scenario-topic", name: "Сценарии доступа" },
    });
    guideSlug = `scenario-guide-${randomUUID()}`;
    guideA = await guide(guideSlug);
    [freeMaterial, productMaterial] = await Promise.all([
      material([], "free"),
      material([guideA]),
    ]);
    videoId = randomUUID();
    providerVideoId = randomUUID();
    await db.prisma.video.create({
      data: {
        id: videoId,
        materialId: productMaterial,
        createdBy: owner,
        access: "membership",
        projectId: "members",
        providerVideoId,
        title: "Видео руководства",
        origin: "platform_upload",
        providerStatus: "done",
        state: "ready",
        readyAt: now,
        providerVisibleAt: now,
        providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`,
        durationSeconds: 60,
      },
    });
    await db.prisma.material.update({
      where: { id: productMaterial },
      data: { primaryVideoId: videoId },
    });
    artifactId = await artifact(guideA);

    productOptionId = (await productOffer(guideA)).optionId;
    // Стартовый тариф открывает все продукты платформы, включая новые.
    tierId = await tier("all");

    grounds.set("guest", [null]);
    grounds.set("account-without-rights", [await account()]);
    grounds.set("one-time-purchase", [await purchased(productOptionId)]);
    grounds.set("tier-via-course", [await assigned("course", null)]);
    grounds.set("tier-via-tribute", [
      (await tributeMember(groundEndsAt)).account,
    ]);
    grounds.set("manual-assignment", [await assigned("manual", groundEndsAt)]);
    // Скрытый тариф даёт сопровождение; после назначения его закрывают для назначений и архивируют.
    const hiddenTier = await tier(
      [guideA],
      ["materials", "community", "support"],
    );
    grounds.set("hidden-active-tier", [
      await assigned("manual", groundEndsAt, hiddenTier),
    ]);
    owned(
      await operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        expectedRevision: 1,
        value: {
          id: hiddenTier,
          name: "Скрытый тариф",
          benefits: ["materials", "community", "support"],
          availableForAssignment: false,
          contentScope: { guideIds: [guideA], materialIds: [] },
        },
      }),
    );
    owned(
      await operations.execute(owner, {
        operation: "offers.archive",
        operationId: randomUUID(),
        id: hiddenTier,
        expectedRevision: 2,
      }),
    );
    grounds.set("direct", [await directHolder()]);

    // Отозванное и истёкшее основание: пока право действовало, чат получил команду впустить.
    const revoked = await account();
    await linkChat(revoked);
    const revokedEnrollment = await assignEnrollment(
      "manual",
      revoked,
      groundEndsAt,
      tierId,
    );
    await project(revoked);
    await revoke(revokedEnrollment);
    const expired = await account();
    await linkChat(expired);
    await assignEnrollment(
      "manual",
      expired,
      "2030-01-01T00:00:00.000Z",
      tierId,
      "2029-12-01T00:00:00.000Z",
    );
    await atMoment("2029-12-15T00:00:00.000Z", () => project(expired));
    grounds.set("expired-or-revoked", [revoked, expired]);

    const multiple = await purchased(productOptionId);
    await assignEnrollment("manual", multiple, groundEndsAt, tierId);
    grounds.set("multiple-grounds", [multiple]);

    const refunded = await account();
    await linkChat(refunded);
    const refundedPurchase = await pay(refunded, productOptionId);
    await project(refunded);
    await refund(refundedPurchase, "withdrawal", guidePriceKopecks);
    grounds.set("withdrawal-refund", [refunded]);

    // Модератор запретил вход: запрет приходит от бота результатом доставки права.
    const moderated = await purchased(productOptionId);
    moderatedIdentities.add(await linkChat(moderated));
    await project(moderated);
    await community.sweep(100);
    grounds.set("moderation", [moderated]);
  });
  afterAll(async () => db.dispose());

  // --------------------------------------------------------------------------- мир сценария

  async function atMoment<T>(
    moment: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = now;
    now = new Date(moment);
    try {
      return await run();
    } finally {
      now = previous;
    }
  }
  async function guide(slug: string): Promise<string> {
    const created = await materials.authoring.createContentCollection({
      actor: owner,
      kind: "guide",
      name: slug,
      slug,
      summary: "",
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }
  function metadataFor(
    guideIds: readonly string[],
    access: "free" | "membership",
    title = `Материал ${randomUUID()}`,
  ) {
    return {
      title,
      summary: "Сценарий доступа",
      access,
      topicId,
      formatId: "guide",
      tagIds: [],
      difficulty: null,
      outcomes: [],
      seriesIds: [...guideIds],
    };
  }
  async function material(
    guideIds: readonly string[],
    access: "free" | "membership" = "membership",
  ): Promise<MaterialId> {
    const metadata = metadataFor(guideIds, access);
    const created = await materials.authoring.createDraft({
      actor: owner,
      idempotencyKey: randomUUID(),
      metadata,
      body: representativeDocument(metadata.title),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({
      actor: owner,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata,
      body: representativeDocument(metadata.title),
    });
    if (!published.ok) throw new Error(published.error.code);
    return checkedMaterialId(created.value.materialId);
  }
  async function artifact(guideId: string): Promise<string> {
    const body = new TextEncoder().encode("# Артефакт руководства\n");
    const created = await guideArtifacts.create({
      actor: owner,
      guideId,
      kind: "file",
      metadata: {
        access: "membership",
        purpose: "Сценарии доступа",
        title: "Закрытый артефакт",
      },
      file: {
        body,
        declaredContentType: "text/markdown",
        declaredSize: body.byteLength,
        expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
        filename: "scenario-artifact.md",
      },
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.artifactId;
  }
  /** Сроки прав Offer продукта словами таблицы: `null` — без срока. */
  function offerPeriods(capability: AccessCapability, terms: OfferTerms) {
    const months = (term: OfferTerm) =>
      term === "lifetime" ? null : term.months;
    return [
      { capability, months: months(terms["product-material"]) },
      { capability: "community", months: months(terms["community-chat"]) },
      { capability: "support", months: months(terms.support) },
    ] as const;
  }
  /**
   * Offer продукта с разовой оплатой. Без сроков — прежний Offer мира: право на продукт без срока и
   * сопровождение на шесть месяцев; со сроками таблицы — Offer называет срок и общей группе.
   */
  async function productOffer(guideId: string, terms?: OfferTerms) {
    const offerId = randomUUID(),
      optionId = randomUUID();
    const capability: AccessCapability = `guide:${guideId}`;
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.save",
        value: {
          id: offerId,
          name: "Продукт сценариев",
          ...(terms === undefined
            ? {
                benefits: [capability, "support"],
                benefitPeriods: [
                  { capability, months: null },
                  { capability: "support", months: 6 },
                ],
              }
            : {
                benefits: [capability, "community", "support"],
                benefitPeriods: [...offerPeriods(capability, terms)],
              }),
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "paymentOptions.save",
        value: {
          id: optionId,
          offerId,
          mode: "one_time",
          months: 1,
          priceKopecks: guidePriceKopecks,
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.publish",
        expectedRevision: 1,
        id: offerId,
      }),
    );
    return { offerId, optionId };
  }
  /** Тариф с правами стартового: материалы, сопровождение и общая группа; состав — все продукты или названные. */
  async function tier(
    guideIds: readonly string[] | "all",
    benefits: readonly string[] = ["materials", "community", "support"],
  ): Promise<string> {
    const id = randomUUID();
    const contentScope =
      guideIds === "all"
        ? { guideIds: [], materialIds: [], allGuides: true }
        : { guideIds: [...guideIds], materialIds: [] };
    owned(
      await operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id,
          name: "Стартовый тариф",
          benefits: [...benefits],
          availableForAssignment: true,
          contentScope,
        },
      }),
    );
    return id;
  }
  async function account(): Promise<string> {
    const id = randomUUID();
    await db.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
      },
    });
    const start = await contact.start(id, {
      operationId: randomUUID(),
      email: `${id}@example.test`,
      expectedRevision: 0,
    });
    if (!start.ok) throw new Error(start.error.code);
    expect(
      await contact.confirm(id, {
        operationId: randomUUID(),
        challengeRef: start.challengeRef,
        code: codes.get(start.challengeRef),
      }),
    ).toMatchObject({ ok: true });
    return id;
  }
  /** Связь Account с Telegram для чата; возвращает identity. */
  async function linkChat(accountId: string): Promise<string> {
    const identityRef = `chat-${accountId}`;
    await linkTelegramAccount(db.prisma, { accountId, identityRef, now });
    return identityRef;
  }
  async function project(accountId: string): Promise<void> {
    expect(await community.project(accountId)).toMatchObject({ ok: true });
  }
  async function pay(buyer: string, optionId: string): Promise<string> {
    const quote = value(
      await pricing.quote(buyer, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
      }),
    );
    const accepted = await contact.acceptConsents(
      buyer,
      pressedPaymentButton({
        operationId: randomUUID(),
        contextRef: quote.quoteRef,
        documents: syntheticConsentDocuments
          .filter((document) => document.kind === "terms")
          .map((document) => ({
            kind: document.kind,
            documentId: document.documentId,
            version: document.version,
            digest: document.digest,
            accepted: true,
          })),
      }),
    );
    if (!accepted.ok) throw new Error(accepted.error.code);
    const bought = value(
      await payments.purchase(buyer, {
        operationId: randomUUID(),
        quoteRef: quote.quoteRef,
        contactRevision: 1,
        consentEvidenceRefs: accepted.evidenceRefs,
        acknowledgeExistingAccess: true,
      }),
    );
    expect(
      await payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED")),
    ).toMatchObject({ ok: true });
    value(await payments.recover());
    purchases.set(buyer, bought.purchaseRef);
    return bought.purchaseRef;
  }
  async function purchased(optionId: string): Promise<string> {
    const buyer = await account();
    await pay(buyer, optionId);
    return buyer;
  }
  /** Участник с подтверждённой связью Telegram и привязанным принципалом: Tribute сверяет его identity. */
  async function participant(prefix: string): Promise<Participant> {
    const accountId = await account();
    const identityRef = `${prefix}-${accountId}`;
    const principalRef = await linkTelegramAccount(db.prisma, {
      accountId,
      identityRef,
      now,
    });
    expect(
      await membership.bindPrincipal({
        accountId: checkedAccountId(accountId),
        principalRef,
      }),
    ).toMatchObject({ ok: true });
    return { account: accountId, identityRef, principalRef };
  }
  /** Строка реестра Tribute по политике стартового тарифа: подтверждённый период или временный источник. */
  async function importTribute(
    member: Participant,
    mode: "confirmed_period" | "temporary_membership",
    endsAt: string,
    existing?: { readonly policyRef: string; readonly subscriptionId: number },
    renewal: "enabled" | "stopped" = "enabled",
  ) {
    let policy = existing;
    if (policy === undefined) {
      const policyRef = randomUUID();
      const subscriptionId = ++tributeSubscription;
      const revision = (
        await db.prisma.billingOffer.findUniqueOrThrow({
          where: { id: tierId },
        })
      ).revision;
      value(
        await convergence.savePolicy(owner, {
          operationId: randomUUID(),
          expectedRevision: 0,
          id: policyRef,
          subscriptionId,
          enabled: true,
          tierId,
          tierRevision: revision,
          temporaryUntil: groundEndsAt,
          reason: "Подтверждённый источник Tribute",
        }),
      );
      policy = { policyRef, subscriptionId };
    }
    let source = await db.prisma.sourceEntitlement.findFirst({
      where: {
        origin: "tribute",
        sourcePolicyRef: policy.policyRef,
        identityRef: member.identityRef,
      },
    });
    if (mode === "temporary_membership" && source === null) {
      // Preserve coverage of historical temporary sources; #1064 rejects new sources.
      const savedPolicy = await db.prisma.tributePolicy.findUniqueOrThrow({
        where: { id: policy.policyRef },
      });
      source = await db.prisma.sourceEntitlement.create({
        data: {
          id: randomUUID(),
          origin: "tribute",
          sourceRef: sourceIdentityRef(
            "tribute",
            policy.policyRef,
            member.identityRef,
          ),
          sourcePolicyRef: policy.policyRef,
          identityRef: member.identityRef,
          revision: 1,
          evidence: { historical: true },
          checkedAt: now,
          tributeState: {
            subscriptionId: policy.subscriptionId,
            telegramUserId: String(policy.subscriptionId),
            verificationRef: randomUUID(),
            mode,
            startsAt: now.toISOString(),
            endsAt,
            renewal,
            tier: savedPolicy.tierSnapshot,
            policyRevision: savedPolicy.revision,
            observation: "pending",
            observedUntil: null,
            observationVersion: null,
            lastEventAt: now.toISOString(),
            lastEventFingerprint: null,
          },
        },
      });
    }
    const row = {
      rowRef: randomUUID(),
      policyRef: policy.policyRef,
      subscriptionId: policy.subscriptionId,
      identityRef: member.identityRef,
      telegramUserId: String(policy.subscriptionId),
      verificationRef: randomUUID(),
      checkedAt: now.toISOString(),
      mode,
      startsAt: now.toISOString(),
      endsAt,
      renewal,
      expectedRevision: source?.revision ?? 0,
      reason: "Подтверждённые даты и identity",
    };
    const preview = value(
      await convergence.preview(owner, {
        operationId: randomUUID(),
        batchRef: row.rowRef,
        rows: [row],
      }),
    );
    value(
      await convergence.apply(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        selectedRows: [row.rowRef],
      }),
    );
    await convergence.sweep();
    return policy;
  }
  async function tributeMember(
    endsAt: string,
    renewal: "enabled" | "stopped" = "enabled",
  ): Promise<Participant> {
    const member = await participant("tribute");
    await importTribute(member, "confirmed_period", endsAt, undefined, renewal);
    return member;
  }
  /** Наблюдение бота за прежней группой: принятое свидетельство членства или выхода. */
  async function observeMembership(
    member: Participant,
    decision: "member" | "not_member",
    version: number,
  ) {
    expect(
      await membership.acceptEvidence({
        accountId: checkedAccountId(member.account),
        deliveryId: randomUUID(),
        source: "member_status_event",
        evidence: {
          contractVersion: "inside.membership-evidence.v1",
          principalRef: member.principalRef,
          telegramIdentityRef: member.identityRef,
          evidenceRef: randomUUID(),
          evidenceVersion: version,
          checkedAt: now.toISOString(),
          validUntil: new Date(now.getTime() + 240_000).toISOString(),
          decision,
          reasonCode: decision === "member" ? "chat_member" : "chat_not_member",
        },
      }),
    ).toMatchObject({ ok: true });
  }
  async function assignEnrollment(
    origin: "course" | "manual",
    recipient: string,
    endsAt: string | null,
    tier: string,
    startsAt = now.toISOString(),
  ) {
    if (
      origin === "manual" &&
      (endsAt !== null || startsAt !== now.toISOString())
    ) {
      const row = await db.prisma.billingOffer.findUniqueOrThrow({
        where: { id: tier },
      });
      const id = randomUUID();
      const terms = { startsAt, endsAt, endPolicy: "fixed" };
      // Historical finite/scheduled assignment: read and expiry remain supported after #1064.
      await db.prisma.subscriptionEnrollment.create({
        data: {
          id,
          accountId: recipient,
          origin: "manual",
          sourceRef: randomUUID(),
          tierId: tier,
          tierRevision: row.revision,
          snapshot: {
            id: tier,
            revision: row.revision,
            name: row.name,
            benefits: row.benefits,
            contentScope: row.contentScope,
          },
          startsAt: new Date(startsAt),
          endsAt: endsAt === null ? null : new Date(endsAt),
          endPolicy: "fixed",
          revision: 1,
          reason: "Historical assignment fixture",
        },
      });
      await db.prisma.accessGrant.create({
        data: {
          id: randomUUID(),
          accountId: recipient,
          enrollmentId: id,
          source: "manual",
          sourceRef: `enrollment:${id}`,
          capabilities: row.benefits,
          contentScope: row.contentScope ?? {},
          startsAt: new Date(startsAt),
          validUntil: endsAt === null ? null : new Date(endsAt),
          revision: 1,
          reason: "Historical assignment fixture",
        },
      });
      return { enrollmentId: id, terms };
    }
    const identityRef = `verified-${recipient}`;
    if (origin === "course")
      await linkTelegramAccount(db.prisma, {
        accountId: recipient,
        identityRef,
        now,
      });
    const revision = (
      await db.prisma.billingOffer.findUniqueOrThrow({ where: { id: tier } })
    ).revision;
    const terms = { startsAt, endsAt, endPolicy: "fixed" };
    const assignedEnrollment = owned(
      await operations.execute(owner, {
        operation: "enrollments.assign",
        operationId: randomUUID(),
        accountId: recipient,
        tierId: tier,
        tierRevision: revision,
        origin,
        sourceRef: `scenario-${randomUUID()}`,
        terms,
        billingRef: null,
        reason: "Сценарий доступа",
        ...(origin === "course"
          ? {
              courseSource: {
                policyRef: "scenario-course",
                verifiedIdentityRef: identityRef,
              },
            }
          : {}),
      }),
    );
    if (assignedEnrollment.outcome !== "enrollment")
      throw new Error(`Unexpected outcome ${assignedEnrollment.outcome}`);
    return { enrollmentId: assignedEnrollment.value.id, terms };
  }
  async function assigned(
    origin: "course" | "manual",
    endsAt: string | null,
    tier = tierId,
  ): Promise<string> {
    const recipient = await account();
    await assignEnrollment(origin, recipient, endsAt, tier);
    return recipient;
  }
  /** Владелец выдаёт приглашение, бот погашает его для новой Telegram-привязки Account. */
  async function redeemInvitation(
    recipient: string,
    offerId: string,
    mode: "purchase",
  ): Promise<void> {
    const identityRef = await linkChat(recipient);
    const issued = owned(
      await operations.execute(owner, {
        operation: "invitations.issue",
        operationId: randomUUID(),
        offerId,
        mode,
      }),
    );
    if (issued.outcome !== "invitation") throw new Error(issued.outcome);
    expect(
      await activation.redeemInvitation({
        contractVersion: "inside.subscription-activation.v1",
        code: issued.value.code,
        identityRef,
      }),
    ).toMatchObject({
      ok: true,
      value: { state: "purchase_ready" },
    });
  }
  /** Прямое право без тарифа: продукт A без даты окончания и отдельное сопровождение до срока. */
  async function directHolder(): Promise<string> {
    const holder = await account();
    const guideRight: AccessCapability = `guide:${guideA}`;
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "guide",
          accountId: holder,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities: [guideRight],
            startsAt: startedAt,
            validUntil: null,
            reason: "Прямое право на продукт",
          },
        },
        {
          rowKey: "support",
          accountId: holder,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities: ["support"],
            startsAt: startedAt,
            validUntil: groundEndsAt,
            reason: "Прямое сопровождение",
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    expect(
      await grants.applyBatch(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        expectedRevision: preview.revision,
        confirmedRows: ["guide", "support"],
      }),
    ).toMatchObject({ ok: true });
    return holder;
  }
  async function revoke(enrollment: {
    readonly enrollmentId: string;
    readonly terms: object;
  }) {
    owned(
      await operations.execute(owner, {
        operation: "enrollments.change",
        operationId: randomUUID(),
        enrollmentId: enrollment.enrollmentId,
        expectedRevision: 1,
        action: "revoke",
        terms: enrollment.terms,
        reason: "Сценарий отзыва",
      }),
    );
  }
  async function refund(
    purchaseRef: string,
    basis: "withdrawal" | "compensation",
    amountKopecks: number,
  ) {
    const decided = owned(
      await operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks,
        basis,
        recurring: "keep",
        reason:
          basis === "withdrawal"
            ? "Возврат по отказу от договора"
            : "Возврат без отказа от договора",
      }),
    );
    if (decided.outcome !== "refundDecision")
      throw new Error(`Unexpected outcome ${decided.outcome}`);
    expect(
      owned(
        await operations.execute(owner, {
          operation: "refunds.execute",
          operationId: randomUUID(),
          decisionRef: decided.value.decisionRef,
          expectedRevision: 1,
        }),
      ),
    ).toMatchObject({
      outcome: "refundDecision",
      value: { state: "executed" },
    });
    value(await payments.recover());
  }

  // ---------------------------------------------------------------- наблюдение через фасады

  const open = (term: AccessTerm): AccessObservation => ({
    outcome: "open",
    term,
  });
  const closed: AccessObservation = { outcome: "closed" };
  const subjectOf = (account: string | null) =>
    account === null
      ? { kind: "anonymous" as const }
      : { kind: "account" as const, accountId: checkedAccountId(account) };
  function termOf(validUntil: string | null): AccessTerm {
    return validUntil === null
      ? "lifetime"
      : validUntil === supportEndsAt
        ? "six-months"
        : "ground-term";
  }
  function actionOf(resource: Resource) {
    return resource.kind === "video"
      ? ("play" as const)
      : resource.kind === "guideArtifact"
        ? ("download" as const)
        : ("read" as const);
  }
  /**
   * Решение ContentAccess словами таблицы. Отказ различает сам фасад: `checkAvailabilityMany`
   * отвечает `locked`, когда ресурс виден с замком, и `unavailable`, когда он закрыт целиком.
   * Видео без тизера наблюдается выдачей ссылки: отказ в ней — закрыто.
   */
  async function decision(
    access: ContentAccess,
    account: string | null,
    resource: Resource,
  ): Promise<AccessObservation> {
    const action = actionOf(resource);
    const enforcementPoint =
      resource.kind === "video"
        ? "playback_token_issue"
        : resource.kind === "guideArtifact"
          ? "guide_artifact_delivery"
          : "published_material_read";
    const decided = await access.authorize({
      subject: subjectOf(account),
      action,
      resource,
      enforcementPoint,
      correlationId: randomUUID(),
    });
    if (decided.effect === "deny") {
      if (resource.kind === "video") return closed;
      const availability = await access.checkAvailabilityMany({
        subject: subjectOf(account),
        enforcementPoint,
        correlationId: randomUUID(),
        operations: [{ itemId: "cell", resource, action }],
      });
      if (!availability.ok) throw new Error(availability.error.code);
      return availability.items[0]?.availability === "locked"
        ? { outcome: "locked" }
        : closed;
    }
    if (!("validUntil" in decided))
      return open(
        decided.reason === "public_resource" ? "public" : "permission",
      );
    return open(termOf(decided.validUntil));
  }
  async function capability(
    account: string | null,
    name: "community" | "support",
  ): Promise<AccessObservation> {
    if (account === null) return closed;
    const resolved = await grants.resolveCapabilities(account);
    if (!resolved.ok) throw new Error(resolved.error.code);
    const found = resolved.capabilities.find(
      (entry) => entry.capability === name,
    );
    return found === undefined ? closed : open(termOf(found.validUntil));
  }
  /** Программа видна, когда её отдаёт чтение программы продукта; замки материалов — отдельная строка. */
  async function programme(
    account: string | null,
    slug: string,
  ): Promise<AccessObservation> {
    const programmeReader = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: () => false },
      contentAccess: readerAccess,
    }).publishedMaterialReader;
    const discovered = await discoverPublishedMaterials(
      programmeReader,
      readerAccess,
      videos,
      { first: null, kind: "series", slug, subject: subjectOf(account) },
    );
    return discovered.ok ? open("public") : closed;
  }
  async function moderationBlocked(account: string): Promise<boolean> {
    return (
      (await community.readOwnAdmission(account)).state === "moderation_blocked"
    );
  }
  /** Чат: запрет модератора закрывает его; без права вход закрыт, если чат уже впускал человека. */
  async function communityChat(
    account: string | null,
  ): Promise<AccessObservation> {
    if (account === null) return closed;
    if (await moderationBlocked(account)) return closed;
    const opened = await capability(account, "community");
    if (opened.outcome === "open") return opened;
    const delivery = await community.readDelivery(owner, account);
    if (!delivery.ok) throw new Error(delivery.error.code);
    return delivery.value.operations.some(
      (operation) => operation.access.kind !== "denied",
    )
      ? { outcome: "entry-closed" }
      : closed;
  }
  /**
   * Сопровождение у тарифа: действует на срок назначения, только если `support` есть в правах тарифа.
   * «По тарифу» — это когда наблюдаемый срок и есть срок назначения; более долгое сопровождение
   * другого основания видно своим сроком.
   */
  async function support(account: string | null): Promise<AccessObservation> {
    const observed = await capability(account, "support");
    if (account === null) return observed;
    const active = value(await grants.readOwnEnrollments(account)).filter(
      (enrollment) => enrollment.state === "active",
    );
    if (active.length === 0) return observed;
    const withSupport = active.filter((enrollment) =>
      enrollment.tier.benefits.includes("support"),
    );
    if (withSupport.length === 0)
      return observed.outcome === "closed" ? { outcome: "by-tier" } : observed;
    const ends = withSupport.map((enrollment) => enrollment.endsAt);
    const tierTerm = ends.includes(null)
      ? "lifetime"
      : termOf(
          ends
            .filter((end): end is string => end !== null)
            .sort()
            .at(-1) ?? null,
        );
    return observed.outcome === "open" && observed.term === tierTerm
      ? { outcome: "by-tier" }
      : observed;
  }
  async function cabinet(account: string): Promise<AccessObservation> {
    if (await moderationBlocked(account))
      return { outcome: "shown", shows: "restriction" };
    const own = value(await grants.readOwnAccess(account));
    const sources = new Set(
      own.grounds
        .filter((ground) => ground.active)
        .map((ground) => ground.source),
    );
    if (sources.size > 1) return { outcome: "shown", shows: "all-grounds" };
    if (sources.size === 1) return { outcome: "shown", shows: "active" };
    const enrollments = value(await grants.readOwnEnrollments(account));
    if (
      enrollments.some(
        (enrollment) =>
          enrollment.state === "expired" || enrollment.state === "revoked",
      )
    )
      return { outcome: "shown", shows: "ended" };
    const purchase = purchases.get(account);
    if (
      purchase !== undefined &&
      value(await payments.status(account, purchase)).state === "confirmed"
    )
      return { outcome: "shown", shows: "purchase-history" };
    return { outcome: "shown", shows: "nothing" };
  }

  interface Target {
    readonly material: MaterialId;
    readonly slug: string;
    readonly artifact: string;
  }

  /** Одна клетка: `null` — у основания нет Account, и клетка по таблице неприменима. */
  async function observe(
    surface: AccessSurface,
    account: string | null,
    target: Partial<Target> = {},
  ): Promise<AccessObservation | null> {
    const {
      material = productMaterial,
      slug = guideSlug,
      artifact: artifactRef = artifactId,
    } = target;
    switch (surface) {
      case "public-material":
        return decision(readerAccess, account, {
          kind: "material",
          materialId: freeMaterial,
        });
      case "product-material":
        return decision(readerAccess, account, {
          kind: "material",
          materialId: material,
        });
      case "programme":
        return programme(account, slug);
      case "artifacts":
        return decision(readerAccess, account, {
          kind: "guideArtifact",
          artifactId: artifactRef,
        });
      case "video":
        return decision(readerAccess, account, { kind: "video", videoId });
      case "community-chat":
        return communityChat(account);
      case "support":
        return support(account);
      case "cabinet":
        return account === null ? null : cabinet(account);
      case "author": {
        if (account === null) return null;
        await db.prisma.accountPermission.upsert({
          where: {
            accountId_permission: {
              accountId: account,
              permission: "materials:manage",
            },
          },
          create: { accountId: account, permission: "materials:manage" },
          update: {},
        });
        return decision(authorAccess, account, {
          kind: "material",
          materialId: material,
        });
      }
      case "mcp": {
        if (account === null) return null;
        const loaded = await materials.authoring.loadMaterial({
          actor: account,
          materialId: material,
        });
        return loaded.ok ? open("permission") : closed;
      }
    }
  }
  function verdict(
    id: string,
    expectation: AccessExpectation | undefined,
    observation: AccessObservation | null,
  ): string | null {
    if (expectation === undefined) return `${id} has no expectation`;
    if (observation === null)
      return expectation.outcome === "not-applicable"
        ? null
        : `${id} could not be observed`;
    return compareAccessObservation(id, expectation, observation);
  }

  // Автор идёт последним: разрешение `materials:manage` выдаётся Account основания прямо перед чтением.
  const surfaceOrder: readonly AccessSurface[] = [
    ...accessSurfaces.filter((surface) => surface !== "author"),
    "author",
  ];
  test.each(
    surfaceOrder.flatMap((surface) =>
      accessGrounds.map(
        (ground) => [accessCellId(surface, ground), surface, ground] as const,
      ),
    ),
  )("%s", async (id, surface, ground) => {
    now = new Date(startedAt);
    const accountsOfGround = grounds.get(ground);
    if (accountsOfGround === undefined)
      throw new Error(`Ground ${ground} was not prepared`);
    const verdicts = [];
    for (const account of accountsOfGround) {
      verdicts.push(
        verdict(
          id,
          accessScenarioTable.cells[surface][ground],
          await observe(surface, account),
        ),
      );
    }
    expect(verdicts.filter((entry) => entry !== null)).toEqual([]);
  });

  // Первый экран продукта прячет оплату по этому ответу. Продукт без опубликованных платных
  // материалов проверяет, что ответ идёт от оснований, а не от программы (#831).
  test("guide-access-without-paid-materials", async () => {
    now = new Date(startedAt);
    const bare = await guide(`bare-product-${randomUUID()}`);
    const namedTier = await tier([bare]);
    const expected: readonly (readonly [string, string | null, string])[] = [
      ["guest", null, "closed"],
      ["account-without-rights", await account(), "closed"],
      [
        "one-time-purchase",
        await purchased((await productOffer(bare)).optionId),
        "open",
      ],
      [
        "tier-naming-product",
        await assigned("manual", groundEndsAt, namedTier),
        "open",
      ],
      ["tier-all-products-via-course", await assigned("course", null), "open"],
      [
        "tier-all-products-via-tribute",
        (await tributeMember(groundEndsAt)).account,
        "open",
      ],
      ["right-to-another-product", await directHolder(), "closed"],
      ...(grounds.get("expired-or-revoked") ?? []).map(
        (holder) => ["expired-or-revoked", holder, "closed"] as const,
      ),
    ];
    const observed = [];
    for (const [ground, holder] of expected)
      observed.push([
        ground,
        holder,
        (
          await readerAccess.checkGuideAccess({
            subject: subjectOf(holder),
            guideId: bare,
          })
        ).kind,
      ]);
    expect(observed).toEqual(expected);
    // Разрешение автора открывает материалы для работы, но не продукт: покупка ему видна.
    expect(
      await authorAccess.checkGuideAccess({
        subject: subjectOf(owner),
        guideId: bare,
      }),
    ).toEqual({ kind: "closed" });
  });

  // ------------------------------------------------------------------------------- переходы

  async function transitionVerdicts(
    id: AccessTransition,
    account: string,
    target: Partial<Target> = {},
  ): Promise<readonly string[]> {
    const after: Readonly<Partial<Record<AccessSurface, AccessExpectation>>> =
      accessScenarioTable.transitions[id].after;
    const verdicts = [];
    for (const surface of accessSurfaces) {
      const expectation = after[surface];
      if (expectation === undefined) continue;
      verdicts.push(
        verdict(
          `${id}:${surface}`,
          expectation,
          await observe(surface, account, target),
        ),
      );
    }
    return verdicts.filter((entry): entry is string => entry !== null);
  }

  test("expiry", async () => {
    now = new Date(startedAt);
    const member = await tributeMember(groundEndsAt);
    await project(member.account);
    expect(await observe("product-material", member.account)).toEqual(
      open("ground-term"),
    );
    await atMoment(groundEndsAt, async () => {
      expect(await transitionVerdicts("expiry", member.account)).toEqual([]);
    });
  });

  test("expiry: исторический конечный доступ закрывается на границе, сообщество получает denied в тот же момент", async () => {
    now = new Date(startedAt);
    const recipient = await account();
    await linkChat(recipient);
    await assignEnrollment("manual", recipient, groundEndsAt, tierId);
    await project(recipient);
    expect(await observe("product-material", recipient)).toEqual(
      open("ground-term"),
    );
    const before = value(await community.readDelivery(owner, recipient));
    expect(before.desired?.access).toEqual({
      kind: "finite",
      validUntil: groundEndsAt,
    });
    expect(before.desired?.nextBoundary).toBe(groundEndsAt);
    await atMoment(groundEndsAt, async () => {
      // Граница сама приводит к пересчёту: запаса после окончания нет.
      await community.sweep(100);
      const after = value(await community.readDelivery(owner, recipient));
      expect(after.desired?.access).toEqual({ kind: "denied" });
      expect(after.operations[0]).toMatchObject({
        access: { kind: "denied" },
        issuedAt: groundEndsAt,
      });
      expect(await transitionVerdicts("expiry", recipient)).toEqual([]);
    });
  });

  test("revocation", async () => {
    now = new Date(startedAt);
    const recipient = await account();
    await linkChat(recipient);
    const enrollment = await assignEnrollment(
      "manual",
      recipient,
      null,
      tierId,
    );
    await project(recipient);
    expect(await observe("product-material", recipient)).toEqual(
      open("lifetime"),
    );
    // Ссылка на видео, выданная до отзыва: после отзыва обратный вызов Kinescope её не принимает.
    const session = await playback.createSession({
      materialId: productMaterial,
      videoId,
      subject: subjectOf(recipient),
      correlationId: randomUUID(),
    });
    const token = session.ok ? session.value.drmAuthToken : null;
    if (typeof token !== "string")
      throw new Error("Expected a protected playback token");
    expect(await playback.authorizeProvider({ providerVideoId, token })).toBe(
      true,
    );
    await revoke(enrollment);
    expect(await playback.authorizeProvider({ providerVideoId, token })).toBe(
      false,
    );
    expect(await transitionVerdicts("revocation", recipient)).toEqual([]);
  });

  test("bridge-replaced-by-tribute", async () => {
    now = new Date(startedAt);
    const member = await participant("bridge");
    expect(
      await grants.classifyLegacy(owner, {
        operationId: randomUUID(),
        accountId: member.account,
        expectedRevision: 0,
        classification: "confirmed_legacy",
        sourceRef: `bridge-${member.account}`,
        reason: "Прежний участник",
        bridgeEnabled: true,
        tributeStopped: false,
      }),
    ).toMatchObject({ ok: true });
    // Мост открывает состав стартового тарифа — все продукты платформы — без `reviews`.
    expect(
      await db.prisma.legacyClassification.findUniqueOrThrow({
        where: { accountId: member.account },
      }),
    ).toMatchObject({
      bridgeContentScope: { guideIds: [], materialIds: [], allGuides: true },
      bridgeBenefits: ["materials", "community"],
    });
    // Мост с сопровождением, но без отдельного `community`: общую группу открывает само сопровождение.
    await db.prisma.legacyClassification.update({
      where: { accountId: member.account },
      data: { bridgeBenefits: ["materials", "support"] },
    });
    await observeMembership(member, "member", 1);
    expect(await observe("support", member.account)).toEqual(
      open("ground-term"),
    );
    expect(await observe("community-chat", member.account)).toEqual(
      open("ground-term"),
    );
    // Временный источник Tribute ещё не подтверждён: мост продолжает действовать.
    const policy = await importTribute(
      member,
      "temporary_membership",
      groundEndsAt,
    );
    expect(
      await db.prisma.legacyClassification.findUniqueOrThrow({
        where: { accountId: member.account },
      }),
    ).toMatchObject({ bridgeEnabled: true });
    expect(await observe("support", member.account)).toEqual(
      open("ground-term"),
    );
    // Подтверждённый период выключает мост: дальше действует назначение по Tribute.
    await importTribute(member, "confirmed_period", groundEndsAt, policy);
    expect(
      await db.prisma.legacyClassification.findUniqueOrThrow({
        where: { accountId: member.account },
      }),
    ).toMatchObject({ bridgeEnabled: false });
    expect(
      await transitionVerdicts("bridge-replaced-by-tribute", member.account),
    ).toEqual([]);
  });

  test("tribute-temporary-source-lost", async () => {
    now = new Date(startedAt);
    const member = await participant("temporary");
    await importTribute(member, "temporary_membership", groundEndsAt);
    await observeMembership(member, "member", 1);
    expect(await observe("product-material", member.account)).toEqual(
      open("ground-term"),
    );
    await project(member.account);
    await observeMembership(member, "not_member", 2);
    expect(
      value(await grants.readOwnEnrollments(member.account))[0]?.state,
    ).toBe("suspended_source");
    expect(
      await transitionVerdicts("tribute-temporary-source-lost", member.account),
    ).toEqual([]);
  });

  test("refund", async () => {
    now = new Date(startedAt);
    const buyer = await account();
    await linkChat(buyer);
    const purchaseRef = await pay(buyer, productOptionId);
    await project(buyer);
    expect(await observe("support", buyer)).toEqual(open("six-months"));
    await refund(purchaseRef, "withdrawal", guidePriceKopecks);
    expect(await transitionVerdicts("refund", buyer)).toEqual([]);
  });

  test("refund-without-withdrawal", async () => {
    now = new Date(startedAt);
    const buyer = await account();
    const purchaseRef = await pay(buyer, productOptionId);
    await refund(purchaseRef, "compensation", 100_000);
    expect(
      await transitionVerdicts("refund-without-withdrawal", buyer),
    ).toEqual([]);
  });

  test("support-kept-by-other-ground", async () => {
    now = new Date(startedAt);
    // Прямое право `support` до срока основания и покупка продукта с шестью месяцами сопровождения.
    const buyer = await account();
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "support",
          accountId: buyer,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities: ["support"],
            startsAt: startedAt,
            validUntil: groundEndsAt,
            reason: "Сопровождение другого основания",
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    expect(
      await grants.applyBatch(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        expectedRevision: preview.revision,
        confirmedRows: ["support"],
      }),
    ).toMatchObject({ ok: true });
    const purchaseRef = await pay(buyer, productOptionId);
    expect(await observe("support", buyer)).toEqual(open("six-months"));
    await refund(purchaseRef, "withdrawal", guidePriceKopecks);
    expect(
      await transitionVerdicts("support-kept-by-other-ground", buyer),
    ).toEqual([]);
  });

  test("material-added-to-product", async () => {
    now = new Date(startedAt);
    const holders = [
      await purchased(productOptionId),
      await assigned("course", null),
      await directHolder(),
    ];
    const added = await material([guideA]);
    const verdicts = [];
    for (const holder of holders)
      verdicts.push(
        ...(await transitionVerdicts("material-added-to-product", holder, {
          material: added,
        })),
      );
    expect(verdicts).toEqual([]);
  });

  test("material-removed-from-product", async () => {
    now = new Date(startedAt);
    const buyer = await purchased(productOptionId);
    const otherGuide = await guide(`scenario-other-${randomUUID()}`);
    const removed = await material([guideA, otherGuide]);
    expect(
      await observe("product-material", buyer, { material: removed }),
    ).toEqual(open("lifetime"));
    const current = await db.prisma.material.findUniqueOrThrow({
      where: { id: removed },
    });
    // Команда сохранения несёт выбор автора целиком: тот же материал без купленного руководства.
    const metadata = metadataFor(
      [otherGuide],
      "membership",
      current.title ?? "",
    );
    const save = (confirmedGuideRemovals: readonly string[]) =>
      materials.authoring.saveMaterial({
        actor: owner,
        idempotencyKey: randomUUID(),
        materialId: removed,
        expectedContentVersion: Number(current.contentVersion),
        publicationState: "published",
        metadata,
        body: representativeDocument(current.title ?? ""),
        confirmedGuideRemovals,
      });
    expect(await save([])).toMatchObject({
      ok: false,
      error: { code: "guide_removal_confirmation_required" },
    });
    expect(
      await observe("product-material", buyer, { material: removed }),
    ).toEqual(open("lifetime"));
    expect(await save([guideA])).toMatchObject({ ok: true });
    expect(
      await transitionVerdicts("material-removed-from-product", buyer, {
        material: removed,
      }),
    ).toEqual([]);
  });

  test("guide-archived", async () => {
    now = new Date(startedAt);
    const archivedSlug = `scenario-archived-${randomUUID()}`;
    const archived = await guide(archivedSlug);
    const step = await material([archived]);
    const archivedArtifact = await artifact(archived);
    const holder = await account();
    const guideRight: AccessCapability = `guide:${archived}`;
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "guide",
          accountId: holder,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities: [guideRight],
            startsAt: startedAt,
            validUntil: null,
            reason: "Покупатель архивного руководства",
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    expect(
      await grants.applyBatch(owner, {
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        expectedRevision: preview.revision,
        confirmedRows: ["guide"],
      }),
    ).toMatchObject({ ok: true });
    const version = (
      await db.prisma.guide.findUniqueOrThrow({ where: { id: archived } })
    ).version;
    expect(
      await materials.authoring.setContentCollectionArchive({
        actor: owner,
        archived: true,
        collectionId: archived,
        expectedVersion: version,
        kind: "guide",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await transitionVerdicts("guide-archived", holder, {
        material: step,
        slug: archivedSlug,
        artifact: archivedArtifact,
      }),
    ).toEqual([]);
  });

  test("tier-composition-change", async () => {
    now = new Date(startedAt);
    const guideC = await guide(`scenario-added-${randomUUID()}`);
    const added = await material([guideC]);
    // Стартовый тариф состава не правит: новый продукт открывается его назначению сам.
    const starter = await assigned("course", null);
    expect(
      await observe("product-material", starter, { material: added }),
    ).toEqual(open("lifetime"));
    const changing = await tier([guideA]);
    const recipient = await account();
    const enrollment = await assignEnrollment(
      "manual",
      recipient,
      groundEndsAt,
      changing,
    );
    const saved = owned(
      await operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        expectedRevision: 1,
        value: {
          id: changing,
          name: "Стартовый тариф",
          benefits: ["materials", "community", "support"],
          availableForAssignment: true,
          contentScope: { guideIds: [guideA, guideC], materialIds: [] },
        },
      }),
    );
    if (saved.outcome !== "catalog")
      throw new Error(`Unexpected outcome ${saved.outcome}`);
    // Новая редакция тарифа сама по себе ничего не открывает действующему назначению.
    expect(
      await observe("product-material", recipient, { material: added }),
    ).toEqual({ outcome: "locked" });
    const expansion = owned(
      await operations.execute(owner, {
        operation: "enrollments.previewExpansion",
        operationId: randomUUID(),
        tierId: changing,
        tierRevision: saved.value.revision,
        targets: [
          {
            enrollmentId: enrollment.enrollmentId,
            expectedRevision: 1,
            tierRevision: 1,
          },
        ],
        reason: "Расширение состава",
      }),
    );
    if (expansion.outcome !== "enrollmentExpansionPreview")
      throw new Error(`Unexpected outcome ${expansion.outcome}`);
    owned(
      await operations.execute(owner, {
        operation: "enrollments.applyExpansion",
        operationId: randomUUID(),
        previewRef: expansion.value.previewRef,
      }),
    );
    expect(
      await transitionVerdicts("tier-composition-change", recipient, {
        material: added,
      }),
    ).toEqual([]);
  });

  test("owner assigns a course tariff with separate benefit terms and no overall expiry", async () => {
    now = new Date(startedAt);
    const courseTier = randomUUID();
    owned(
      await operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: courseTier,
          name: "Course assignment",
          benefits: [`guide:${guideA}`, "community", "support"],
          benefitPeriods: [{ capability: "support", months: 6 }],
          availableForAssignment: true,
        },
      }),
    );
    const recipient = await account();
    const listed = owned(
      await operations.execute(owner, {
        operation: "tiers.list",
        operationId: randomUUID(),
        limit: 100,
      }),
    );
    if (listed.outcome !== "tiers") throw new Error(listed.outcome);
    expect(listed.items.map((entry) => entry.tier.id)).toContain(courseTier);
    const assigned = owned(
      await operations.execute(owner, {
        operation: "enrollments.assign",
        operationId: randomUUID(),
        accountId: recipient,
        tierId: courseTier,
        tierRevision: 1,
        origin: "manual",
        sourceRef: randomUUID(),
        terms: { startsAt: startedAt, endsAt: null, endPolicy: "fixed" },
        billingRef: null,
        reason: "Owner assigns course",
      }),
    );
    expect(assigned).toMatchObject({
      outcome: "enrollment",
      value: { endsAt: null, startsAt: startedAt },
    });
    const enrollment = value(await grants.readOwnEnrollments(recipient))[0];
    expect(enrollment?.benefitTerms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: `guide:${guideA}`,
          endsAt: null,
        }),
        expect.objectContaining({ capability: "community", endsAt: null }),
        expect.objectContaining({
          capability: "support",
          endsAt: subscriptionPeriodEnd(now, 6).toISOString(),
        }),
      ]),
    );
  });

  test("tier-archived-with-assignments", async () => {
    now = new Date(startedAt);
    const archivedTier = await tier([guideA]);
    const recipient = await assigned("manual", groundEndsAt, archivedTier);
    owned(
      await operations.execute(owner, {
        operation: "offers.archive",
        operationId: randomUUID(),
        id: archivedTier,
        expectedRevision: 1,
      }),
    );
    expect(
      await operations.execute(owner, {
        operation: "enrollments.assign",
        operationId: randomUUID(),
        accountId: await account(),
        tierId: archivedTier,
        tierRevision: 2,
        origin: "manual",
        sourceRef: randomUUID(),
        terms: {
          startsAt: now.toISOString(),
          endsAt: null,
          endPolicy: "fixed",
        },
        billingRef: null,
        reason: "Назначение по архивному тарифу",
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(
      await transitionVerdicts("tier-archived-with-assignments", recipient),
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------------- публикация

  test("standalone-membership-publication-rejected", async () => {
    now = new Date(startedAt);
    const scenario =
      accessScenarioTable.publications[
        "standalone-membership-publication-rejected"
      ];
    const metadata = metadataFor([], "membership");
    const created = await materials.authoring.createDraft({
      actor: owner,
      idempotencyKey: randomUUID(),
      metadata,
      body: representativeDocument(metadata.title),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({
      actor: owner,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata,
      body: representativeDocument(metadata.title),
    });
    expect(published).toMatchObject({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: scenario.rejectedWith }],
      },
    });
    expect(
      await db.prisma.publishedMaterial.count({
        where: { materialId: created.value.materialId },
      }),
    ).toBe(0);
  });

  // ------------------------------------------------------------------------------- покупки

  /** Срок права словами таблицы: без даты окончания или число календарных месяцев с оплаты. */
  function describeTerm(term: OfferTerm): string {
    return term === "lifetime" ? "lifetime" : `${String(term.months)} months`;
  }
  function observedTerm(validUntil: string | null, paidAt: Date): string {
    if (validUntil === null) return "lifetime";
    for (let months = 1; months <= 1200; months += 1)
      if (subscriptionPeriodEnd(paidAt, months).toISOString() === validUntil)
        return `${String(months)} months`;
    return `until ${validUntil}`;
  }
  /** Что открыто у покупателя: материал продукта, общая группа и сопровождение со своими сроками. */
  async function grantedTerms(
    account: string,
    paidAt: Date,
  ): Promise<Readonly<Record<keyof OfferTerms, string>>> {
    const material = await readerAccess.authorize({
      subject: subjectOf(account),
      action: "read",
      resource: { kind: "material", materialId: productMaterial },
      enforcementPoint: "published_material_read",
      correlationId: randomUUID(),
    });
    const resolved = await grants.resolveCapabilities(account);
    if (!resolved.ok) throw new Error(resolved.error.code);
    const capabilityTerm = (name: AccessCapability) => {
      const found = resolved.capabilities.find(
        (entry) => entry.capability === name,
      );
      return found === undefined
        ? "closed"
        : observedTerm(found.validUntil, paidAt);
    };
    return {
      "product-material":
        material.effect === "deny" || !("validUntil" in material)
          ? "closed"
          : observedTerm(material.validUntil, paidAt),
      "community-chat": capabilityTerm("community"),
      support: capabilityTerm("support"),
    };
  }
  function termVerdicts(
    id: string,
    expected: OfferTerms,
    observed: Readonly<Record<keyof OfferTerms, string>>,
  ): readonly string[] {
    return (["product-material", "community-chat", "support"] as const)
      .filter((right) => describeTerm(expected[right]) !== observed[right])
      .map(
        (right) =>
          `${id}:${right} expected ${describeTerm(expected[right])} but observed ${observed[right]}`,
      );
  }

  test("course-offer-terms", async () => {
    now = new Date(startedAt);
    const scenario = accessScenarioTable.purchases["course-offer-terms"];
    const { optionId } = await productOffer(guideA, scenario.offer);
    const buyer = await purchased(optionId);
    expect(
      termVerdicts(
        "course-offer-terms",
        scenario.granted,
        await grantedTerms(buyer, now),
      ),
    ).toEqual([]);
  });

  test("offer-own-terms", async () => {
    now = new Date(startedAt);
    const scenario = accessScenarioTable.purchases["offer-own-terms"];
    const { optionId } = await productOffer(guideA, scenario.offer);
    const buyer = await purchased(optionId);
    expect(
      termVerdicts(
        "offer-own-terms",
        scenario.granted,
        await grantedTerms(buyer, now),
      ),
    ).toEqual([]);
  });

  test("offer-terms-change-keeps-earlier-purchase", async () => {
    now = new Date(startedAt);
    const scenario =
      accessScenarioTable.purchases[
        "offer-terms-change-keeps-earlier-purchase"
      ];
    const { offerId, optionId } = await productOffer(
      guideA,
      accessScenarioTable.purchases["course-offer-terms"].offer,
    );
    const earlier = await purchased(optionId);
    const capability: AccessCapability = `guide:${guideA}`;
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.save",
        expectedRevision: 2,
        value: {
          id: offerId,
          name: "Продукт сценариев",
          benefits: [capability, "community", "support"],
          benefitPeriods: [...offerPeriods(capability, scenario.offer)],
        },
      }),
    );
    const later = await purchased(optionId);
    expect([
      ...termVerdicts(
        "offer-terms-change-keeps-earlier-purchase:earlier",
        scenario.granted,
        await grantedTerms(earlier, now),
      ),
      ...termVerdicts(
        "offer-terms-change-keeps-earlier-purchase:later",
        scenario.offer,
        await grantedTerms(later, now),
      ),
    ]).toEqual([]);
  });

  /** Offer подписки со стартовым составом с ограничением допуска. */
  async function restrictedSubscriptionOffer(
    eligibility: "former_tribute_subscribers" | "invitation_only",
  ) {
    const offerId = randomUUID(),
      optionId = randomUUID();
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.save",
        value: {
          id: offerId,
          name:
            eligibility === "invitation_only"
              ? "Подписка по приглашению"
              : "Подписка прежних подписчиков Tribute",
          benefits: ["community", "materials", "support"],
          contentScope: { guideIds: [], materialIds: [], allGuides: true },
          eligibility,
          // Подарок по приглашению назначает этот же Offer.
          availableForAssignment: eligibility === "invitation_only",
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "paymentOptions.save",
        value: {
          id: optionId,
          offerId,
          mode: "subscription",
          months: 1,
          priceKopecks: guidePriceKopecks,
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.publish",
        expectedRevision: 1,
        id: offerId,
      }),
    );
    return { offerId, optionId };
  }
  let subscriptionOffer:
    { readonly offerId: string; readonly optionId: string } | undefined;
  async function restrictedSubscription() {
    subscriptionOffer ??= await restrictedSubscriptionOffer(
      "former_tribute_subscribers",
    );
    return subscriptionOffer;
  }
  let invitationOffer:
    { readonly offerId: string; readonly optionId: string } | undefined;
  async function invitationSubscription() {
    invitationOffer ??= await restrictedSubscriptionOffer("invitation_only");
    return invitationOffer;
  }
  /**
   * Видит ли Account Offer на витрине подписки и предлагается ли ему подписка вообще. Account,
   * допущенный к другому Offer по приглашению, подписку видит, поэтому `alsoAdmitted` снимает
   * сверку с общим признаком продажи.
   */
  async function listed(
    account: string,
    offerId: string,
    alsoAdmitted = false,
  ): Promise<boolean> {
    const page = value(await pricing.offers({ mode: "subscription" }, account));
    const inCatalog = page.items.some((item) => item.offer.id === offerId);
    expect(await pricing.hasOffersForSale(account)).toBe(
      inCatalog || alsoAdmitted,
    );
    return inCatalog;
  }
  /** Покупка подписки: расчёт, оферта и согласие на списания, ответ банка и выдача прав. */
  async function buySubscription(
    buyer: string,
    optionId: string,
  ): Promise<string | null> {
    const quote = await pricing.quote(buyer, {
      operationId: randomUUID(),
      paymentOptionId: optionId,
      optionRevision: 1,
    });
    if (!quote.ok) return quote.error.code;
    const accepted = await contact.acceptConsents(
      buyer,
      pressedPaymentButton(
        {
          operationId: randomUUID(),
          contextRef: quote.value.quoteRef,
          documents: syntheticConsentDocuments
            .filter(
              (document) =>
                document.kind === "terms" || document.kind === "recurring",
            )
            .map((document) => ({
              kind: document.kind,
              documentId: document.documentId,
              version: document.version,
              digest: document.digest,
              accepted: true,
            })),
        },
        quote.value,
      ),
    );
    if (!accepted.ok) throw new Error(accepted.error.code);
    const bought = await payments.purchase(buyer, {
      operationId: randomUUID(),
      quoteRef: quote.value.quoteRef,
      contactRevision: 1,
      consentEvidenceRefs: accepted.evidenceRefs,
      acknowledgeExistingAccess: true,
    });
    if (!bought.ok) return bought.error.code;
    expect(
      await payments.notification(
        bank.notify(bought.value.purchaseRef, "CONFIRMED"),
      ),
    ).toMatchObject({ ok: true });
    value(await payments.recover());
    expect(
      value(await payments.status(buyer, bought.value.purchaseRef)).state,
    ).toBe("confirmed");
    return null;
  }

  test("subscription-offer-without-tribute-ground", async () => {
    now = new Date(startedAt);
    const scenario =
      accessScenarioTable.purchases[
        "subscription-offer-without-tribute-ground"
      ];
    const { offerId, optionId } = await restrictedSubscription();
    // Ни новый Account, ни покупатель продукта, ни участник по курсу основания Tribute не имеют.
    for (const buyer of [
      await account(),
      await purchased(productOptionId),
      await assigned("course", null),
    ]) {
      expect(await listed(buyer, offerId)).toBe(scenario.listed);
      expect(await buySubscription(buyer, optionId)).toBe(
        scenario.rejectedWith,
      );
    }
  });

  test("subscription-offer-with-tribute-ground", async () => {
    now = new Date(startedAt);
    const scenario =
      accessScenarioTable.purchases["subscription-offer-with-tribute-ground"];
    const { offerId, optionId } = await restrictedSubscription();
    const member = await tributeMember(groundEndsAt, "stopped");
    // Покупка с автосписаниями по-прежнему ждёт решения владельца об остановке списаний Tribute.
    expect(
      await grants.classifyLegacy(owner, {
        operationId: randomUUID(),
        accountId: member.account,
        expectedRevision: 0,
        classification: "confirmed_legacy",
        sourceRef: `tribute-${member.account}`,
        reason: "Прежний подписчик Tribute",
        bridgeEnabled: false,
        tributeStopped: true,
      }),
    ).toMatchObject({ ok: true });
    // Продление — после окончания оплаченного в Tribute периода.
    now = new Date(new Date(groundEndsAt).getTime() + 86_400_000);
    expect(await listed(member.account, offerId)).toBe(scenario.listed);
    expect(await buySubscription(member.account, optionId)).toBe(
      scenario.rejectedWith,
    );
  });

  test("invitation-offer-after-purchase-invitation", async () => {
    now = new Date(startedAt);
    const scenario =
      accessScenarioTable.purchases[
        "invitation-offer-after-purchase-invitation"
      ];
    const { offerId, optionId } = await invitationSubscription();
    const invited = await account();
    await redeemInvitation(invited, offerId, "purchase");
    expect(await listed(invited, offerId)).toBe(scenario.listed);
    expect(await buySubscription(invited, optionId)).toBe(
      scenario.rejectedWith,
    );
    // Допуск постоянный: после оплаченного срока тот же Offer рассчитывается без новой ссылки.
    now = new Date(
      subscriptionPeriodEnd(new Date(startedAt), 1).getTime() + 86_400_000,
    );
    expect(await listed(invited, offerId)).toBe(scenario.listed);
    expect(
      await pricing.quote(invited, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
      }),
    ).toMatchObject({ ok: true });
  });

  test("invitation-offer-without-invitation", async () => {
    now = new Date(startedAt);
    const scenario =
      accessScenarioTable.purchases["invitation-offer-without-invitation"];
    const { offerId, optionId } = await invitationSubscription();
    const other = await restrictedSubscriptionOffer("invitation_only");
    const invitedElsewhere = await account();
    await redeemInvitation(invitedElsewhere, other.offerId, "purchase");
    for (const buyer of [
      await account(),
      invitedElsewhere,
      await assigned("manual", null),
      await assigned("course", null),
    ]) {
      expect(await listed(buyer, offerId, buyer === invitedElsewhere)).toBe(
        scenario.listed,
      );
      expect(await buySubscription(buyer, optionId)).toBe(
        scenario.rejectedWith,
      );
    }
  });

  test("gift invitation cannot grant access or purchase admission", async () => {
    now = new Date(startedAt);
    const { offerId } = await invitationSubscription();
    expect(
      await operations.execute(owner, {
        operation: "invitations.issue",
        operationId: randomUUID(),
        offerId,
        mode: "gift",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});
