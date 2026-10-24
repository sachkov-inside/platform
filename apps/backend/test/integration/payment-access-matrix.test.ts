import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { authorProductProgramme } from "../fixtures/author-product-programme.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { assembleProductMaterials } from "../../src/modules/materials/index.js";

import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
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
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import {
  BillingPayments,
  type BillingPricing,
} from "../../src/modules/billing/index.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import {
  assembleProductArtifactDelivery,
  assembleProductArtifactResourceFacts,
  assembleProductArtifacts,
} from "../../src/modules/products/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import {
  assembleMaterialResourceFacts,
  materialId as checkedMaterialId,
  type MaterialId,
} from "../../src/modules/materials/index.js";
import { assembleAssetResourceFacts } from "../../src/modules/materials/adapters/content-access/asset-resource-facts.js";
import { assembleVideoResourceFacts } from "../../src/modules/materials/adapters/content-access/video-resource-facts.js";
import { assembleMaterialAssetDelivery } from "../../src/modules/materials/features/deliver-material-asset/deliver-material-asset.js";
import { assembleVideoPlayback } from "../../src/modules/materials/facets/video-playback/video-playback.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { createTestVideoProvider } from "../../src/modules/videos/adapters/kinescope/test-video-provider.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";

import { discoverPublishedMaterials } from "../../src/modules/content-library/index.js";
import type {
  ObjectStorage,
  StoredObject,
} from "../../src/infrastructure/object-storage/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { BankFixture } from "./setup/bank.js";

import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  pressedPaymentButton,
  syntheticConsentDocuments,
} from "./setup/consent-documents.js";
import { hasText } from "../../src/infrastructure/contracts/text.js";

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
/** Владельческий результат читается по объявленному виду, а не по форме поля. */

const config = syntheticTbankConfig({
  environment: "demo",
  terminalKey: "SYNTHETICMATRIX",
  password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 61).toString("base64"),
  minimumKopecks: 100,
  maximumKopecks: 10_000_000,
  returnUrl: "https://inside.example.test/account",
  notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" },
});
const documents = syntheticConsentDocuments
  .filter((d) => d.kind === "terms")
  .map((d) => ({ ...d, commercialModel: "product-lifetime-v1" as const }));
const productPriceKopecks = 290_000;

const startedAt = "2030-01-31T10:00:00Z";
// Подписка куплена 31 января: её оплаченный срок заканчивается в последний день февраля.

/** Сопровождение купленного продукта: шесть месяцев с подтверждения оплаты. */

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
  let membership: ReturnType<typeof assembleAccountRights>;
  let materials: ReturnType<typeof assembleMaterials>;
  let contact: BillingContact;
  let accounts: ReturnType<typeof assembleAccounts>;
  const codes = new Map<string, string>();
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
  let productA: string, productB: string, productSlug: string, topicId: string;
  let libraryProduct: string;
  let freeMaterial: MaterialId,
    libraryMaterial: MaterialId,
    productMaterial: MaterialId,
    sharedMaterial: MaterialId,
    otherProductMaterial: MaterialId;
  let chapterId: string;
  /** Один закрытый ресурс каждого вида: файл в теле, первичное видео и артефакт руководства. */
  let productResources: {
    readonly assetId: string;
    readonly videoId: string;
    readonly providerVideoId: string;
    readonly artifactId: string;
  };
  let access: ReturnType<typeof assembleContentAccess>;
  let delivery: ReturnType<typeof assembleMaterialAssetDelivery>;
  let artifacts: ReturnType<typeof assembleProductArtifactDelivery>;
  let playback: ReturnType<typeof assembleVideoPlayback>;
  let videos: ReturnType<typeof assembleVideos>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
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
      emailFingerprintKey: "synthetic-matrix-fingerprint-key-00000",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: new TelegramAccountLinks(db.prisma),
      clock: () => now,
    });
    membership = assembleAccountRights({
      prisma: db.prisma,
      clock: () => now,
    });
    pricing = assembleTestBillingPricing({
      prisma: db.prisma,
      accounts,
      clock: () => now,
      sale: { payments: true },
    });
    contact = new BillingContact({
      prisma: db.prisma,
      protection: billingContactProtection(
        Buffer.alloc(32, 62).toString("base64"),
      ),
      documents,
      now: () => now,
      sendCode: (message) => {
        codes.set(message.challengeRef, message.code);
        return Promise.resolve();
      },
    });
    materials = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: (id) => id === owner },
    });
    topicId = randomUUID();
    await db.prisma.topic.create({
      data: { id: topicId, slug: "matrix-topic", name: "Синтетическая тема" },
    });

    productSlug = `matrix-product-${randomUUID()}`;
    productA = await product(productSlug);
    productB = await product(`matrix-other-${randomUUID()}`);
    // Закрытый материал публикуется только внутри продукта. Материал «библиотеки» живёт в своём
    // руководстве, которое не продаётся: открыть его может только состав тарифа. Отдельный
    // материал в состав не входит (#648).
    libraryProduct = await product(`matrix-library-${randomUUID()}`);
    [
      freeMaterial,
      libraryMaterial,
      productMaterial,
      sharedMaterial,
      otherProductMaterial,
    ] = await Promise.all([
      material([], "free"),
      material([libraryProduct]),
      material([productA]),
      material([productA, productB]),
      material([productB]),
    ]);
    chapterId = await chapter(productA, [productMaterial, sharedMaterial]);

    const assets = assembleMaterialAssets({
      prisma: db.prisma,
      objectStorage: storage,
    });
    videos = assembleVideos({
      prisma: db.prisma,
      provider: createTestVideoProvider(),
      projects: { free: "free", closed: "members" },
      canManage: () => Promise.resolve(false),
      clock: () => now,
    });
    const bytes = new TextEncoder().encode("Синтетический файл руководства");
    const uploaded = await assets.upload({
      actor: owner,
      materialId: productMaterial,
      body: bytes,
      declaredContentType: "text/plain",
      declaredSize: bytes.length,
      expectedChecksumSha256: createHash("sha256").update(bytes).digest("hex"),
      filename: "product-file.txt",
      idempotencyKey: randomUUID(),
      kind: "file",
    });
    if (!uploaded.ok) throw new Error(uploaded.error.code);
    const videoId = randomUUID(),
      providerVideoId = randomUUID();
    await db.prisma.video.create({
      data: {
        id: videoId,
        materialId: productMaterial,
        createdBy: owner,
        access: "closed",
        projectId: "members",
        providerVideoId,
        title: "Синтетическое видео руководства",
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
      data: {
        primaryVideoId: videoId,
        body: {
          type: "doc",
          content: [
            {
              type: "assetFile",
              attrs: {
                nodeId: randomUUID(),
                assetId: uploaded.value.assetId,
                label: "Файл руководства",
              },
            },
          ],
        },
      },
    });

    const productArtifacts = assembleProductArtifacts({
      materials: assembleProductMaterials(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      prisma: db.prisma,
      objectStorage: storage,
      authorPolicy: { canManage: (id) => id === owner },
    });
    const artifactBody = new TextEncoder().encode("# Синтетический артефакт\n");
    const created = await productArtifacts.create({
      actor: owner,
      productId: productA,
      kind: "file",
      metadata: {
        access: "closed",
        purpose: "Проверка доступа матрицы",
        title: "Закрытый артефакт",
      },
      file: {
        body: artifactBody,
        declaredContentType: "text/markdown",
        declaredSize: artifactBody.byteLength,
        expectedChecksumSha256: createHash("sha256")
          .update(artifactBody)
          .digest("hex"),
        filename: "matrix-artifact.md",
      },
    });
    if (!created.ok) throw new Error(created.error.code);
    productResources = {
      assetId: uploaded.value.assetId,
      videoId,
      providerVideoId,
      artifactId: created.value.artifactId,
    };

    access = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      assetResourceFacts: assembleAssetResourceFacts(assets),
      videoResourceFacts: assembleVideoResourceFacts(videos),
      productArtifactResourceFacts:
        assembleProductArtifactResourceFacts(productArtifacts),
      accountPermissions: {
        hasMaterialsManage: (id) => Promise.resolve(id === owner),
      },
      accountRights: membership,
    });
    artifacts = assembleProductArtifactDelivery({
      artifacts: productArtifacts,
      contentAccess: access,
      objectStorage: storage,
      signedGetTtlSeconds: 60,
    });
    delivery = assembleMaterialAssetDelivery({
      assets,
      contentAccess: access,
      materialContent: materials.materialContent,
      objectStorage: storage,
      signedGetTtlSeconds: 60,
    });
    playback = assembleVideoPlayback({
      contentAccess: access,
      videos,
      jwtSecret: "synthetic-matrix-playback-key-508",
      jwtTtlSeconds: 60,
      clock: () => now,
    });
  });
  afterAll(async () => db.dispose());

  async function product(slug: string): Promise<string> {
    const created = await materials.authoring.createContentCollection({
      actor: owner,
      kind: "product",
      name: slug,
      slug,
      summary: "",
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }
  /** Опубликованный материал нужного состава: доступ к нему решает только матрица прав. */
  async function material(
    productIds: readonly string[],
    accessClass: "free" | "closed" = "closed",
  ): Promise<MaterialId> {
    const title = `Материал ${randomUUID()}`;
    const metadata = {
      title,
      summary: "Синтетическое описание матрицы доступа",
      access: accessClass,
      topicId,
      formatId: "guide",
      tagIds: [],
      difficulty: null,
      outcomes: [],
      productIds: [...productIds],
    };
    const created = await materials.authoring.createDraft({
      actor: owner,
      idempotencyKey: randomUUID(),
      metadata,
      body: representativeDocument(title),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({
      actor: owner,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata,
      body: representativeDocument(title),
    });
    if (!published.ok) throw new Error(published.error.code);
    return checkedMaterialId(created.value.materialId);
  }
  /** Одна глава руководства: она остаётся видимой и тогда, когда её материалы закрыты. */
  async function chapter(
    productId: string,
    ordered: readonly MaterialId[],
  ): Promise<string> {
    const loaded = await materials.authoring.loadProductOrder({
      actor: owner,
      productId: productId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const id = randomUUID();
    const saved = await authorProductProgramme(materials.authoring, {
      actor: owner,
      productId: productId,
      expectedOrderVersion: loaded.value.orderVersion,
      orderedMaterialIds: [...ordered],
      chapters: [{ id, name: "Первая глава", summary: "" }],
      chapterAssignments: Object.fromEntries(
        ordered.map((value) => [value, id]),
      ),
    });
    if (!saved.ok) throw new Error(saved.error.code);
    return id;
  }

  /**
   * Продление и восстановление обходят всю базу файла, поэтому сценарий, который их запускает,
   * начинает с закрытия чужих расписаний и незавершённых попыток. Тот же приём в `scenario()`
   * набора `billing-subscriptions`.
   */
  async function ownSweeps(): Promise<void> {
    for (const stale of await db.prisma.billingSubscription.findMany({
      where: { state: { not: "ended" } },
    }))
      await db.prisma.billingSubscription.update({
        where: { id: stale.id },
        data: { state: "ended", revision: stale.revision + 1, updatedAt: now },
      });
    await db.prisma.billingPurchase.updateMany({
      where: {
        state: { in: ["prepared", "sent", "unknown", "pending", "authorized"] },
      },
      data: { state: "failed", lifecycleActive: false },
    });
    await db.prisma.billingPurchase.updateMany({
      where: { kind: "initial", lifecycleActive: true },
      data: { lifecycleActive: false },
    });
  }

  /**
   * Покупатель с подтверждённым контактом: дальше он платит настоящим путём. Без решения
   * владельца он остаётся неопределённым, и подписка ему недоступна.
   */
  async function buyer(
    _options: { readonly classify?: boolean } = {},
  ): Promise<string> {
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
  /** Предложение владельца: подписка на библиотеку либо разовая цена одного руководства. */
  async function offer(input: {
    readonly name: string;
    readonly benefits: readonly string[];
    readonly mode?: "one_time";
    readonly priceKopecks: number;
    readonly benefitPeriods?: readonly {
      capability: string;
      months: number | null;
    }[];
  }) {
    const productId = input.benefits
      .find((c) => c.startsWith("product:"))
      ?.slice(8);
    if (productId === undefined)
      throw new Error("Expected Product price target");
    const current = await db.prisma.billingProductPrice.findUnique({
      where: { productId },
    });
    if (current === null)
      value(
        await pricing.manage(owner, {
          operation: "productPrices.save",
          operationId: randomUUID(),
          value: {
            productId,
            name: input.name,
            priceKopecks: input.priceKopecks,
            published: true,
          },
        }),
      );
    return { offerId: productId, optionId: productId };
  }
  async function productOffer() {
    await db.prisma.historicalProductCommunityRecord.upsert({
      where: { productId: productA },
      create: {
        productId: productA,
        groupRef: "primary",
        updatedBy: owner,
        updatedAt: now,
      },
      update: { groupRef: "primary", updatedAt: now },
    });
    return offer({
      name: "Руководство «Синтетика»",
      benefits: [`product:${productA}`, "community", "support"],
      mode: "one_time",
      priceKopecks: productPriceKopecks,
      benefitPeriods: [
        { capability: `product:${productA}`, months: null },
        { capability: "community", months: null },
        { capability: "support", months: 6 },
      ],
    });
  }
  /** Один платёжный стенд: свой банк, свои платежи и своё продление. */
  function billingStand() {
    const bank = new BankFixture(config);
    const client = bank.client();
    const payments = new BillingPayments({
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      sale: { payments: true },
      prisma: db.prisma,
      bank: client,
      contact,
      grants,
      clock: () => now,
    });
    /** Оплаченная покупка целиком: команда, ответ банка и выдача прав одним шагом. */
    async function pay(
      account: string,
      optionId: string,
      options: {
        readonly recurring?: boolean;
        readonly acknowledgeExistingAccess?: boolean;
      } = {},
    ) {
      const bought = value(
        await purchase(payments, account, optionId, options),
      );
      if (options.recurring === true)
        expect(
          await payments.notification(
            bank.notify(bought.purchaseRef, "AUTHORIZED", {
              RebillId: "synthetic-card",
            }),
          ),
        ).toMatchObject({ ok: true });
      expect(
        await payments.notification(
          bank.notify(bought.purchaseRef, "CONFIRMED"),
        ),
      ).toMatchObject({ ok: true });
      value(await payments.recover());
      return bought.purchaseRef;
    }
    return { bank, payments, pay };
  }
  /** Расчёт и согласия одной покупки: подписка принимает списания, разовая — только оферту. */
  async function command(
    account: string,
    optionId: string,
    options: {
      readonly recurring?: boolean;
      readonly acknowledgeExistingAccess?: boolean;
    } = {},
  ) {
    const quote = value(
      await pricing.quote(account, {
        operationId: randomUUID(),
        productId: optionId,
        priceRevision: 1,
      }),
    );
    const accepted = await contact.acceptConsents(
      account,
      pressedPaymentButton(
        {
          operationId: randomUUID(),
          contextRef: quote.quoteRef,
          documents: documents
            .filter(
              (document) =>
                options.recurring === true || document.kind === "terms",
            )
            .map((document) => ({
              kind: document.kind,
              documentId: document.documentId,
              version: document.version,
              digest: document.digest,
              accepted: true,
            })),
        },
        { snapshot: quote.snapshot },
      ),
    );
    if (!accepted.ok) throw new Error(accepted.error.code);
    return {
      operationId: randomUUID(),
      quoteRef: quote.quoteRef,
      contactRevision: 1,
      consentEvidenceRefs: accepted.evidenceRefs,
      acknowledgeExistingAccess: options.acknowledgeExistingAccess === true,
    };
  }
  /** Путь покупки целиком: расчёт, согласия, команда и ответ банка без выдачи прав. */
  async function purchase(
    payments: BillingPayments,
    account: string,
    optionId: string,
    options: {
      readonly recurring?: boolean;
      readonly acknowledgeExistingAccess?: boolean;
    } = {},
  ) {
    return payments.purchase(
      account,
      await command(account, optionId, options),
    );
  }

  const context = {
    enforcementPoint: "published_material_read" as const,
    correlationId: randomUUID(),
  };

  const reader = (account: string) => ({
    kind: "account" as const,
    accountId: checkedAccountId(account),
  });
  function decide(
    subject:
      | { kind: "anonymous" }
      | { kind: "account"; accountId: ReturnType<typeof checkedAccountId> },
    id: MaterialId,
  ) {
    return access.authorize({
      ...context,
      subject,
      action: "read",
      resource: { kind: "material", materialId: id },
    });
  }
  /** Программа руководства глазами читателя: главы видны, а материалы — по праву. */
  async function productProgramme(
    subject:
      | { kind: "anonymous" }
      | { kind: "account"; accountId: ReturnType<typeof checkedAccountId> },
  ) {
    const discovered = await discoverPublishedMaterials(
      materials.publishedMaterialReader,
      access,
      videos,
      { first: null, kind: "product", slug: productSlug, subject },
    );
    return value(discovered);
  }

  test("путь покупки руководства открывает ровно его материалы, файлы, видео и артефакты", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const account = await buyer();
    const { optionId } = await productOffer();
    const { bank, payments } = billingStand();

    // До оплаты руководство закрыто, а его глава остаётся видимой витриной программы.
    expect(await decide(reader(account), productMaterial)).toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });
    expect(
      await delivery.deliver({
        materialId: productMaterial,
        assetId: productResources.assetId,
        contentVersion: 2,
        preview: false,
        subject: reader(account),
      }),
    ).toMatchObject({ ok: false, error: { code: "asset_not_found" } });
    expect(
      await playback.createSession({
        materialId: productMaterial,
        videoId: productResources.videoId,
        subject: reader(account),
        correlationId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "access_denied" } });
    expect(
      await artifacts.deliver({
        artifactId: productResources.artifactId,
        productId: productA,
        preview: false,
        subject: reader(account),
        version: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "artifact_not_found" } });
    // Описание главы доходит до читателя вместе с программой; у этой главы его просто нет.
    const chapters = [
      {
        id: chapterId,
        materialIds: [productMaterial, sharedMaterial],
        name: "Первая глава",
        summary: "",
        // Заданий в этом руководстве нет (#947).
        tasks: [],
      },
    ];
    const before = await productProgramme(reader(account));
    expect(before.chapters).toEqual(chapters);
    expect(before.items.map((item) => item.availability)).toEqual([
      "locked",
      "locked",
    ]);

    const bought = value(await purchase(payments, account, optionId));
    expect(bought.access).toBe("awaiting_payment");
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: account } }),
    ).toBe(0);
    expect(
      await payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED")),
    ).toMatchObject({ ok: true });
    value(await payments.recover());
    expect(
      value(await payments.status(account, bought.purchaseRef)),
    ).toMatchObject({
      state: "confirmed",
      access: "ready",
      periodEndsAt: null,
    });

    // Одна оплата — одно бессрочное право ровно на купленное руководство.
    const granted = await db.prisma.productAccess.findMany({
      where: { accountId: account, productId: productA },
    });
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({
      accountId: account,
      productId: productA,
      revokedAt: null,
      firstIssuedAt: new Date(startedAt),
    });
    expect(
      value(await payments.status(account, bought.purchaseRef)).snapshot
        .supportMonths,
    ).toBe(3);
    expect(bank.initCalls).toBe(1);

    for (const id of [productMaterial, sharedMaterial])
      expect(await decide(reader(account), id)).toMatchObject({
        effect: "allow",
        reason: "active_membership",
        validUntil: null,
      });
    // Прямой адрес чужого руководства и библиотечного материала остаётся закрытым.
    for (const id of [libraryMaterial, otherProductMaterial])
      expect(await decide(reader(account), id)).toMatchObject({
        effect: "deny",
        reason: "membership_required",
      });
    expect(await decide(reader(account), freeMaterial)).toMatchObject({
      effect: "allow",
      reason: "public_resource",
    });

    const subject = reader(account);
    expect(
      await delivery.deliver({
        materialId: productMaterial,
        assetId: productResources.assetId,
        contentVersion: 2,
        preview: false,
        subject,
      }),
    ).toMatchObject({ ok: true, value: { kind: "redirect" } });
    const session = await playback.createSession({
      materialId: productMaterial,
      videoId: productResources.videoId,
      subject,
      correlationId: randomUUID(),
    });
    if (!session.ok || !hasText(session.value.drmAuthToken))
      throw new Error("Expected a protected playback token");
    expect(
      await playback.authorizeProvider({
        providerVideoId: productResources.providerVideoId,
        token: session.value.drmAuthToken,
      }),
    ).toBe(true);

    // Файлы, видео и артефакты руководства открываются тем же правом, что и его материалы.
    expect(
      await artifacts.deliver({
        artifactId: productResources.artifactId,
        productId: productA,
        preview: false,
        subject,
        version: 1,
      }),
    ).toMatchObject({
      ok: true,
      value: { kind: "redirect", cacheScope: "private-no-store" },
    });
    const after = await productProgramme(reader(account));
    expect(after.chapters).toEqual(chapters);
    expect(after.items.map((item) => item.availability)).toEqual([
      "available",
      "available",
    ]);
  });

  test("повтор и опоздание платёжного события не создают второго права и второго списания", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const account = await buyer();
    const { optionId } = await productOffer();
    const { bank, payments } = billingStand();
    const purchaseCommand = await command(account, optionId);
    const bought = value(await payments.purchase(account, purchaseCommand));
    // Та же команда из второй вкладки возвращает исходную покупку, а не вторую попытку.
    expect(
      value(await payments.purchase(account, purchaseCommand)).purchaseRef,
    ).toBe(bought.purchaseRef);
    const repeated = await Promise.all(
      Array.from({ length: 6 }, () =>
        payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED")),
      ),
    );
    expect(repeated.every((result) => result.ok)).toBe(true);
    expect(
      await db.prisma.billingPaymentEvent.count({
        where: { purchaseRef: bought.purchaseRef },
      }),
    ).toBe(1);
    value(await payments.recover());
    const granted = await db.prisma.productAccess.findMany({
      where: { accountId: account, productId: productA },
    });
    expect(granted).toHaveLength(1);
    expect(granted[0]?.firstIssuedAt?.toISOString()).toBe(
      "2030-01-31T10:00:00.000Z",
    );

    // Опоздавшее уведомление и поздняя сверка приходят неделей позже и ничего не переписывают.
    now = new Date("2030-02-07T10:00:00Z");
    const late = await Promise.all([
      payments.notification(bank.notify(bought.purchaseRef, "CONFIRMED")),
      payments.reconcile(bought.purchaseRef),
      payments.recover(),
    ]);
    expect(late.every((result) => result.ok)).toBe(true);
    expect(
      value(await payments.status(account, bought.purchaseRef)),
    ).toMatchObject({ state: "confirmed", access: "ready" });
    expect(
      await db.prisma.productAccess.findMany({
        where: { accountId: account, productId: productA },
      }),
    ).toMatchObject([
      { firstIssuedAt: new Date("2030-01-31T10:00:00Z"), revokedAt: null },
    ]);
    expect(
      await db.prisma.billingPurchase.count({ where: { accountId: account } }),
    ).toBe(1);
    expect(bank.initCalls).toBe(1);
    expect(await decide(reader(account), productMaterial)).toMatchObject({
      effect: "allow",
      reason: "active_membership",
      validUntil: null,
    });
  });

  test("отказ и неизвестный ответ банка не открывают доступ и не выдаются за успех", async () => {
    now = new Date(startedAt);
    await ownSweeps();
    const [refused, silent] = await Promise.all([buyer(), buyer()]);
    const { optionId } = await productOffer();
    const { bank, payments } = billingStand();
    const rejected = value(await purchase(payments, refused, optionId));
    expect(
      await payments.notification(
        bank.notify(rejected.purchaseRef, "REJECTED"),
      ),
    ).toMatchObject({ ok: true });
    expect(
      value(await payments.status(refused, rejected.purchaseRef)),
    ).toMatchObject({ state: "failed", access: "awaiting_payment" });
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: refused } }),
    ).toBe(0);
    expect(await decide(reader(refused), productMaterial)).toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });

    // Банк принял запрос и замолчал: исход неизвестен, повтор запрещён, доступа нет.
    bank.failInit = true;
    const pending = await command(silent, optionId);
    const unknown = value(await payments.purchase(silent, pending));
    expect(unknown).toMatchObject({
      state: "unknown",
      access: "awaiting_payment",
    });
    expect(value(await payments.purchase(silent, pending)).purchaseRef).toBe(
      unknown.purchaseRef,
    );
    expect(bank.initCalls).toBe(2);
    value(await payments.recover());
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: silent } }),
    ).toBe(0);
    expect(await decide(reader(silent), productMaterial)).toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });

    // Тот же платёж, сверенный после ответа банка, выдаёт право один раз.
    bank.failInit = false;
    bank.settle(unknown.purchaseRef, "CONFIRMED");
    expect(await payments.reconcile(unknown.purchaseRef)).toMatchObject({
      ok: true,
    });
    value(await payments.recover());
    expect(bank.initCalls).toBe(2);
    expect(
      await db.prisma.productAccess.count({
        where: { accountId: silent, productId: productA },
      }),
    ).toBe(1);
    expect(await decide(reader(silent), productMaterial)).toMatchObject({
      effect: "allow",
      reason: "active_membership",
      validUntil: null,
    });
  });

  /**
   * Общий чат открывает не название тарифа, а любое действующее право: и состав старшей подписки,
   * и купленное руководство. Решение владельца от 12.09.2026: срок участия равен сроку права.
   */

  /**
   * Право на руководство уже открывает чат, поэтому старший тариф пересекается с ним составом.
   * Покупатель об этом предупреждён и продолжает подтверждением, а не обходом проверки.
   */
});
