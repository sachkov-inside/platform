import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  parsePlatformConfig,
  PLATFORM_CONFIG,
} from "../../src/config/platform-config.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import {
  BillingProductSales,
  BillingSurveyRespondentSales,
} from "../../src/modules/billing/index.js";
import {
  assembleMaterials,
  ProductOutlines,
} from "../../src/modules/materials/index.js";
import { MaterialFirstOpens } from "../../src/modules/reading-activity/index.js";
import { SalesFunnel } from "../../src/modules/sales-funnel/facets/sales-funnel/sales-funnel.js";
import { RecordBotEventsController } from "../../src/modules/sales-funnel/features/record-bot-events/record-bot-events.controller.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const version = "inside.sales-funnel-events.v1";
const secret = "test-sales-funnel-ingress-secret";
const topicId = randomUUID();
const author = randomUUID();
const from = "2030-03-01T00:00:00.000Z";
const to = "2030-04-01T00:00:00.000Z";
const before = new Date("2030-02-15T10:00:00.000Z");
const inside = (day: number) =>
  new Date(`2030-03-${String(day).padStart(2, "0")}T10:00:00.000Z`);

describe("Sales funnel report on PostgreSQL", () => {
  let db: TestDatabase;
  let http: NestFastifyApplication;
  let funnel: SalesFunnel;
  let owner: string;
  let productId: string;
  let otherProductId: string;
  let firstChapter: string;
  let secondChapter: string;
  const material: Record<"first" | "second" | "third", string> = {
    first: "",
    second: "",
    third: "",
  };

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = (
      await bootstrapOwnerAccount(
        db.prisma,
        { issuer: "https://funnel.example.test", subject: "owner" },
        "billing:manage",
      )
    ).accountId;
    const materials = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: () => true },
    });
    await db.prisma.topic.create({
      data: { id: topicId, slug: "sales-funnel", name: "Sales funnel" },
    });
    const product = async (slug: string) => {
      const created = await materials.authoring.createContentCollection({
        actor: author,
        kind: "product",
        name: slug,
        slug,
        summary: "",
      });
      if (!created.ok) throw new Error(created.error.code);
      return created.value.id;
    };
    productId = await product("ai-engineering");
    otherProductId = await product("other-course");
    const publish = async (title: string) => {
      const metadata = {
        access: "free" as const,
        formatId: "guide",
        difficulty: null,
        outcomes: [],
        seriesIds: [productId],
        summary: `${title} summary.`,
        tagIds: [],
        title,
        topicId,
      };
      const created = await materials.authoring.createDraft({
        actor: author,
        idempotencyKey: randomUUID(),
        metadata,
        body: representativeDocument(`${title} body.`),
      });
      if (!created.ok) throw new Error(created.error.code);
      const published = await materials.authoring.saveMaterial({
        actor: author,
        idempotencyKey: randomUUID(),
        materialId: created.value.materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata,
        body: representativeDocument(`${title} body.`),
      });
      if (!published.ok) throw new Error(published.error.code);
      return created.value.materialId;
    };
    material.first = await publish("Проекты");
    material.second = await publish("Локальный MCP");
    material.third = await publish("Агенты");
    firstChapter = randomUUID();
    secondChapter = randomUUID();
    const order = await materials.authoring.loadSeriesOrder({
      actor: author,
      seriesId: productId,
    });
    if (!order.ok) throw new Error(order.error.code);
    const saved = await materials.authoring.reorderSeries({
      actor: author,
      seriesId: productId,
      expectedOrderVersion: order.value.orderVersion,
      orderedMaterialIds: [material.first, material.second, material.third],
      chapters: [
        { id: firstChapter, name: "Глава 1", summary: "" },
        { id: secondChapter, name: "Глава 2", summary: "" },
      ],
      chapterAssignments: {
        [material.first]: firstChapter,
        [material.second]: firstChapter,
        [material.third]: secondChapter,
      },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    funnel = new SalesFunnel({
      prisma: db.prisma,
      accounts: assembleAccounts({
        prisma: db.prisma,
        emailFingerprintKey: "sales-funnel-test-fingerprint-secret",
      }),
      links: new TelegramAccountLinks(db.prisma),
      outlines: new ProductOutlines(db.prisma),
      firstOpens: new MaterialFirstOpens(db.prisma),
      sales: new BillingProductSales(db.prisma),
      surveyRespondents: new BillingSurveyRespondentSales(db.prisma),
      clock: () => new Date("2030-04-02T00:00:00.000Z"),
    });
    @Module({
      controllers: [RecordBotEventsController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: SalesFunnel, useValue: funnel },
        {
          provide: PLATFORM_CONFIG,
          useValue: parsePlatformConfig({
            NODE_ENV: "test",
            TELEGRAM_SALES_FUNNEL_INGRESS_SECRET: secret,
          }),
        },
      ],
    })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete fixture module.
    class FixtureModule {}
    http = await NestFactory.create<NestFastifyApplication>(
      FixtureModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await http.init();
    await http.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await http.close();
    await db.dispose();
  });

  async function deliver(
    events: readonly object[],
    credential: string | null = secret,
  ) {
    const url = "/integrations/telegram/v1/sales-funnel/events";
    const response = await http.inject({
      method: "POST",
      url,
      headers:
        credential === null ? {} : { authorization: `Bearer ${credential}` },
      payload: { contractVersion: version, events },
    });
    assertDeclaredResponse({
      method: "POST",
      url,
      status: response.statusCode,
      body: () => response.json(),
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return { status: response.statusCode, body: response.json<unknown>() };
  }

  const entered = (
    contactRef: string,
    sourceCode: string | null,
    at: Date,
  ) => ({
    eventId: randomUUID(),
    contactRef,
    occurredAt: at.toISOString(),
    kind: "bot_entered",
    sourceCode,
  });
  const consent = (contactRef: string, granted: boolean, at: Date) => ({
    eventId: randomUUID(),
    contactRef,
    occurredAt: at.toISOString(),
    kind: "marketing_consent",
    granted,
  });
  const linked = (contactRef: string, telegramIdentityRef: string) => ({
    eventId: randomUUID(),
    contactRef,
    occurredAt: inside(20).toISOString(),
    kind: "account_linked",
    telegramIdentityRef,
  });

  async function account(identityRef?: string) {
    const id = randomUUID();
    await db.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://funnel.example.test",
        logtoSubject: id,
      },
    });
    if (identityRef !== undefined)
      await db.prisma.telegramAccountLinkState.create({
        data: {
          accountId: id,
          linkRef: randomUUID(),
          revision: 1,
          principalRef: `principal-${id}`,
          identityRef,
          updatedAt: inside(20),
        },
      });
    return id;
  }
  const open = (accountId: string, materialId: string, at: Date) =>
    db.prisma.readingMaterialVisit.create({
      data: { accountId, materialId, firstOpenedAt: at, lastOpenedAt: at },
    });
  const scope = (productIds: readonly string[], wholePlatform = false) => ({
    offer: {
      coverage: {
        productIds,
        materialIds: [],
        ...(wholePlatform ? { wholePlatform: true } : {}),
      },
    },
  });
  async function quote(
    accountId: string,
    snapshot: object,
    at: Date,
  ): Promise<string> {
    const id = randomUUID();
    await db.prisma.billingPriceQuote.create({
      data: {
        id,
        accountId,
        operationId: randomUUID(),
        fingerprint: id,
        snapshot,
        createdAt: at,
        expiresAt: new Date(at.getTime() + 3_600_000),
      },
    });
    return id;
  }
  async function purchase(
    accountId: string,
    state: "confirmed" | "failed",
    at: Date,
    product = productId,
  ) {
    const snapshot = scope([product]);
    const quoteRef = await quote(accountId, snapshot, at);
    const id = randomUUID();
    await db.prisma.billingPurchase.create({
      data: {
        id,
        accountId,
        quoteRef,
        kind: "one_time",
        lifecycleActive: false,
        state,
        environment: "test",
        terminalRef: "terminal",
        paymentId: randomUUID(),
        amountKopecks: 100_000n,
        snapshot,
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        confirmedAt: state === "confirmed" ? at : null,
        createdAt: at,
        updatedAt: at,
      },
    });
    return { id, quoteRef };
  }

  test("accepts bot events once and rejects a changed replay or a foreign credential", async () => {
    const contact = randomUUID();
    const event = entered(contact, "m_probe", before);
    expect(await deliver([event], null)).toMatchObject({ status: 401 });
    expect(await deliver([event], "another-telegram-secret")).toMatchObject({
      status: 401,
    });
    expect(await deliver([event])).toEqual({
      status: 200,
      body: { contractVersion: version, accepted: 1, duplicates: 0 },
    });
    expect(await deliver([event, event])).toEqual({
      status: 200,
      body: { contractVersion: version, accepted: 0, duplicates: 2 },
    });
    const fresh = consent(contact, true, before);
    expect(
      await deliver([fresh, { ...event, sourceCode: "m_other" }]),
    ).toMatchObject({ status: 409, body: { code: "event_conflict" } });
    // The conflicting delivery is rejected as a whole: its new event is not recorded either.
    expect(
      await db.prisma.salesFunnelBotEvent.count({
        where: { eventId: fresh.eventId },
      }),
    ).toBe(0);
    expect(
      await deliver([{ ...event, eventId: randomUUID(), sourceCode: "бот" }]),
    ).toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(
      await deliver([{ ...linked(contact, "identity"), telegramUserId: 42 }]),
    ).toMatchObject({ status: 400 });
    await db.prisma.salesFunnelBotEvent.deleteMany({});
    // Before the bot reports anything its steps are unknown, not zero.
    const silent = await funnel.readReport(owner, { from, to });
    if (!silent.ok) throw new Error(silent.error.code);
    expect(silent.value.lastBotEventReceivedAt).toBeNull();
    expect(silent.value.total).toEqual(counts(null, null, null, null, null));
    // Before the survey list is uploaded the share has no basis: unavailable, not zero.
    expect(silent.value.surveyRespondents).toBeNull();
  });

  test("follows the cohort that entered in the period on test data that matches bot events and payments", async () => {
    // Accounts exist before the bot reports the links, so the link Account is stored at intake.
    const buyer = await account("identity-survey-buyer");
    const reader = await account("identity-survey-reader");
    const earlier = await account("identity-returning");
    const unlabelled = await account("identity-linked-only");
    const outside = await account();
    const februaryReader = await account();
    const [surveyBuyer, surveyReader, site, direct, returning, linkedOnly] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const accepted = await deliver([
      entered(surveyBuyer, "m_survey", inside(2)),
      entered(surveyBuyer, "m_site", inside(3)),
      consent(surveyBuyer, true, inside(2)),
      consent(surveyBuyer, false, inside(10)),
      linked(surveyBuyer, "identity-survey-buyer"),
      entered(surveyReader, "m_survey", inside(4)),
      linked(surveyReader, "identity-survey-reader"),
      entered(site, "m_site", inside(5)),
      entered(direct, null, inside(7)),
      entered(returning, null, before),
      consent(returning, true, inside(6)),
      linked(returning, "identity-returning"),
      linked(linkedOnly, "identity-linked-only"),
    ]);
    expect(accepted).toMatchObject({ status: 200, body: { accepted: 13 } });
    // A later unlink does not move the buyer's purchase out of its source.
    await db.prisma.telegramAccountLinkState.delete({
      where: { accountId: buyer },
    });

    await open(buyer, material.second, inside(12));
    // The reader of the cohort opened the chapter before the period: it still counts by now.
    await open(reader, material.first, before);
    await open(unlabelled, material.third, inside(12));
    await open(outside, material.first, inside(13));
    await quote(buyer, scope([productId]), inside(14));
    await purchase(buyer, "confirmed", inside(15));
    // Entered the bot before the period: outside this cohort although it paid within it.
    await purchase(earlier, "confirmed", inside(15));
    // Its first step for the Product was before the period: outside this cohort in every chapter.
    await open(februaryReader, material.first, before);
    await purchase(februaryReader, "confirmed", inside(15));
    await quote(outside, scope([productId]), inside(16));
    await purchase(outside, "failed", inside(17));
    await quote(reader, scope([otherProductId]), inside(14));
    await quote(unlabelled, scope([], true), inside(14));

    const report = await funnel.readReport(owner, { from, to, productId });
    if (!report.ok) throw new Error(report.error.code);
    expect(report.value.selection).toEqual({
      productId,
      chapterId: firstChapter,
    });
    expect(report.value.products.find((item) => item.id === productId)).toEqual(
      {
        id: productId,
        name: "ai-engineering",
        chapters: [
          { id: firstChapter, name: "Глава 1" },
          { id: secondChapter, name: "Глава 2" },
        ],
      },
    );
    expect(report.value.rows).toEqual([
      {
        source: { kind: "label", code: "m_site" },
        counts: counts(1, 0, 0, 0, 0),
      },
      {
        source: { kind: "label", code: "m_survey" },
        counts: counts(2, 1, 2, 1, 1),
      },
      {
        source: { kind: "unlabelled" },
        counts: counts(1, 0, 0, 0, 0),
      },
      {
        source: { kind: "outside_bot" },
        counts: counts(null, null, 1, 1, 0),
      },
    ]);
    expect(report.value.total).toEqual(counts(4, 1, 3, 2, 1));
    expect(report.value.lastBotEventReceivedAt).not.toBeNull();

    // A linked contact without an entry has no source: its Account joins by its first step.
    const later = await funnel.readReport(owner, {
      from,
      to,
      productId,
      chapterId: secondChapter,
    });
    if (!later.ok) throw new Error(later.error.code);
    expect(later.value.rows).toContainEqual({
      source: { kind: "outside_bot" },
      counts: counts(null, null, 1, 1, 0),
    });

    const bareBot = await funnel.readReport(owner, { from, to });
    if (!bareBot.ok) throw new Error(bareBot.error.code);
    expect(bareBot.value.selection).toBeNull();
    expect(bareBot.value.total).toEqual(counts(4, 1, null, null, null));
  });

  test("counts survey respondents who bought the Product through their personal link in the period", async () => {
    let respondent = 0;
    // Synthetic list entries: the report and this test never name a real respondent.
    const listed = async (promotionId: string | null) => {
      respondent += 1;
      await db.prisma.billingSurveyRespondent.create({
        data: {
          username: `respondent_${String(respondent)}`,
          importedAt: before,
          promotionId,
          issuedAt: promotionId === null ? null : before,
        },
      });
    };
    async function withPersonalLink() {
      const promotionId = randomUUID();
      await db.prisma.billingPromotion.create({
        data: {
          id: promotionId,
          revision: 1,
          name: "Скидка анкеты",
          percent: 10,
          code: `code-${promotionId}`,
          startsAt: before,
          endsAt: new Date("2030-12-31T00:00:00.000Z"),
          offerIds: [],
          paymentOptionIds: [],
          usageLimit: 1,
        },
      });
      await listed(promotionId);
      return promotionId;
    }
    async function boughtWith(
      promotionId: string,
      state: "confirmed" | "failed",
      at: Date,
      product = productId,
    ) {
      const accountId = await account();
      const bought = await purchase(accountId, state, at, product);
      await db.prisma.billingPromoReservation.create({
        data: {
          purchaseRef: bought.id,
          accountId,
          quoteRef: bought.quoteRef,
          promotionId,
          state,
          snapshot: {},
        },
      });
    }

    await boughtWith(await withPersonalLink(), "confirmed", inside(18));
    await boughtWith(await withPersonalLink(), "confirmed", before);
    await boughtWith(await withPersonalLink(), "failed", inside(18));
    await boughtWith(
      await withPersonalLink(),
      "confirmed",
      inside(18),
      otherProductId,
    );
    // An issued link nobody used and a listed username without a link.
    await withPersonalLink();
    await listed(null);
    // A full-price purchase without a personal link is not a respondent's purchase.
    await purchase(await account(), "confirmed", inside(18));

    const report = await funnel.readReport(owner, { from, to, productId });
    if (!report.ok) throw new Error(report.error.code);
    expect(report.value.surveyRespondents).toEqual({
      uploaded: 6,
      issued: 5,
      paid: 1,
    });

    const earlier = await funnel.readReport(owner, {
      from: "2030-02-01T00:00:00.000Z",
      to: from,
      productId,
    });
    if (!earlier.ok) throw new Error(earlier.error.code);
    expect(earlier.value.surveyRespondents).toEqual({
      uploaded: 6,
      issued: 5,
      paid: 1,
    });

    const bareBot = await funnel.readReport(owner, { from, to });
    if (!bareBot.ok) throw new Error(bareBot.error.code);
    expect(bareBot.value.surveyRespondents).toEqual({
      uploaded: 6,
      issued: 5,
      paid: null,
    });
  });

  test("records a link with its Account on a pool that one transaction holds whole", async () => {
    const linkedAccount = await account("identity-pool");
    const contact = randomUUID();
    const event = linked(contact, "identity-pool");
    const recorded = await withExhaustedPool(db, (prisma) =>
      new SalesFunnel({
        prisma,
        accounts: assembleAccounts({
          prisma,
          emailFingerprintKey: "sales-funnel-test-fingerprint-secret",
        }),
        links: new TelegramAccountLinks(prisma),
        outlines: new ProductOutlines(prisma),
        firstOpens: new MaterialFirstOpens(prisma),
        sales: new BillingProductSales(prisma),
        surveyRespondents: new BillingSurveyRespondentSales(prisma),
        clock: () => new Date("2030-04-02T00:00:00.000Z"),
      }).recordBotEvents({ contractVersion: version, events: [event] }),
    );
    expect(recorded).toMatchObject({ ok: true, value: { accepted: 1 } });
    expect(
      await db.prisma.salesFunnelBotEvent.findUnique({
        where: { eventId: event.eventId },
        select: { accountId: true },
      }),
    ).toEqual({ accountId: linkedAccount });
  });

  test("answers only the owner and rejects an unknown selection or an empty period", async () => {
    const stranger = await account();
    expect(await funnel.readReport(stranger, { from, to })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      await funnel.readReport(owner, { from, to, productId: randomUUID() }),
    ).toEqual({ ok: false, error: { code: "product_not_found" } });
    expect(
      await funnel.readReport(owner, {
        from,
        to,
        productId,
        chapterId: randomUUID(),
      }),
    ).toEqual({ ok: false, error: { code: "chapter_not_found" } });
    expect(await funnel.readReport(owner, { from: to, to: from })).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
  });
});

function counts(
  entered: number | null,
  consented: number | null,
  openedChapter: number | null,
  checkout: number | null,
  paid: number | null,
) {
  return { entered, consented, openedChapter, checkout, paid };
}
