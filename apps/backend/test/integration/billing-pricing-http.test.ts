import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import {
  BillingOperations,
  BillingPricing,
  registerBillingTools,
} from "../../src/modules/billing/index.js";

import { registerFixedClock } from "../support/fixed-clock.js";

import { seedPurchaseInvitation } from "./setup/purchase-invitation.js";
import { randomUUID } from "node:crypto";
import { acceptCurrentTerms } from "../support/accept-terms.js";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { declaredServer } from "../support/declared-api.js";
import { bindConfirmedTributeSource } from "./setup/tribute-source.js";

registerFixedClock();

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";

describe("Billing pricing HTTP", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let database: TestDatabase;
  let jwksServer: Server;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "api-key-1",
    };
    jwksServer = createServer((request, response) => {
      if (request.url !== "/jwks") return void response.writeHead(404).end();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, "127.0.0.1", resolve),
    );
    const address = jwksServer.address();
    if (address === null || typeof address === "string")
      throw new Error("missing JWKS port");

    database = await createMigratedTestDatabase();
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY:
          "accounts-api-test-email-fingerprint-key",
        // Каталог включает продажу только в процессе с терминалом и адресом для чека.
        TBANK_PROVIDER_MODE: "test",
        BILLING_CONTACT_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
        BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
        BILLING_CONTACT_FROM: "inside@example.test",
      }),
      { logger: false },
    );
    await app.init();
    await declaredServer(app.getHttpAdapter().getInstance()).ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  });

  test("public catalog, trusted quote identity, owner authorization and wire conflicts", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const token = await signToken();
    const headers = { authorization: `Bearer ${token}` };
    const offerId = randomUUID();
    const optionId = randomUUID();
    const command = {
      operation: "offers.save",
      operationId: randomUUID(),
      value: {
        id: offerId,
        name: "Inside",
        benefits: ["materials"],
        coverage: { productIds: [randomUUID()], materialIds: [] },
      },
    };
    expect(
      (await server.inject({ method: "GET", url: "/billing/offers" })).json(),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          payload: command,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/accounts/current/billing/quote",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await server.inject({ method: "POST", url: "/accounts", headers }))
        .statusCode,
    ).toBe(201);
    await acceptCurrentTerms(server, headers);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: command,
        })
      ).statusCode,
    ).toBe(403);
    const account = await database.prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: "human-api-001",
        },
      },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: account.id, permission: "platform:admin" },
    });
    const saved = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: command,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers["cache-control"]).toBe("private, no-store");
    expect(saved.json()).toEqual({
      operationRef: command.operationId,
      result: {
        outcome: "catalog",
        value: { id: offerId, revision: 1, archived: false, published: false },
      },
    });
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: { ...command, actor: account.id },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: {
            operation: "paymentOptions.save",
            operationId: randomUUID(),
            value: {
              id: optionId,
              offerId,
              mode: "one_time",
              months: 5,
              priceKopecks: 500_000,
            },
          },
        })
      ).statusCode,
    ).toBe(200);
    // По умолчанию предложение не продаётся: пока владелец не включит его, витрина пуста.
    const publishOperationId = randomUUID();
    const published = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: {
        operation: "offers.publish",
        operationId: publishOperationId,
        expectedRevision: 1,
        id: offerId,
      },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({
      operationRef: publishOperationId,
      result: {
        outcome: "catalog",
        value: { id: offerId, revision: 2, archived: false, published: true },
      },
    });
    const list = await server.inject({
      method: "GET",
      url: "/billing/offers?limit=1",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [{ firstPriceKopecks: 500_000, renewalPriceKopecks: 500_000 }],
    });
    const quote = {
      operationId: randomUUID(),
      paymentOptionId: optionId,
      optionRevision: 1,
    };
    const response = await server.inject({
      method: "POST",
      url: "/accounts/current/billing/quote",
      headers,
      payload: quote,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      snapshot: { firstPriceKopecks: 500_000, paymentOption: { months: 5 } },
    });
    const stored = await database.prisma.billingPriceQuote.findUniqueOrThrow({
      where: {
        accountId_operationId: {
          accountId: account.id,
          operationId: quote.operationId,
        },
      },
    });
    expect(stored.accountId).toBe(account.id);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/accounts/current/billing/quote",
          headers,
          payload: { ...quote, accountId: randomUUID() },
        })
      ).statusCode,
    ).toBe(400);
    const stale = await server.inject({
      method: "POST",
      url: "/accounts/current/billing/quote",
      headers,
      payload: { ...quote, operationId: randomUUID(), optionRevision: 99 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers["content-type"]).toContain("application/problem+json");
    expect(stale.json()).toMatchObject({ code: "quote_changed" });
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/reservations",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);

    // Второй вариант включается отдельно: сначала продан только первый, затем оба.
    const secondOfferId = randomUUID();
    const secondOptionId = randomUUID();
    await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: secondOfferId,
          name: "Сопровождение",
          benefits: ["support"],
          coverage: { productIds: [randomUUID()], materialIds: [] },
        },
      },
    });
    await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: {
          id: secondOptionId,
          offerId: secondOfferId,
          mode: "one_time",
          months: 1,
          priceKopecks: 350_000,
        },
      },
    });
    const one = await server.inject({
      method: "GET",
      url: "/billing/offers?limit=100",
    });
    expect(one.json<{ items: readonly unknown[] }>().items).toHaveLength(1);
    await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: {
        operation: "offers.publish",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: secondOfferId,
      },
    });
    const both = await server.inject({
      method: "GET",
      url: "/billing/offers?limit=100",
    });
    expect(both.json<{ items: readonly unknown[] }>().items).toHaveLength(2);
    // Выключение первого варианта убирает только его; выключенный не покупается даже напрямую.
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: {
            operation: "offers.unpublish",
            operationId: randomUUID(),
            expectedRevision: 2,
            id: offerId,
          },
        })
      ).statusCode,
    ).toBe(200);
    const onlySecond = await server.inject({
      method: "GET",
      url: "/billing/offers?limit=100",
    });
    expect(
      onlySecond
        .json<{
          items: readonly { readonly offer: { readonly id: string } }[];
        }>()
        .items.map((item) => item.offer.id),
    ).toEqual([secondOfferId]);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/accounts/current/billing/quote",
          headers,
          payload: {
            operationId: randomUUID(),
            paymentOptionId: optionId,
            optionRevision: 1,
          },
        })
      ).statusCode,
    ).toBe(404);
  });

  test("scoped billing permission opens the owner surface and maps its result codes", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const headers = {
      authorization: `Bearer ${await signToken({ subject: "billing-manager-001", email: "manager@example.test" })}`,
    };
    expect(
      (await server.inject({ method: "POST", url: "/accounts", headers }))
        .statusCode,
    ).toBe(201);
    await acceptCurrentTerms(server, headers);
    const manager = await database.prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: "billing-manager-001",
        },
      },
    });
    const payments = { operation: "payments.list", operationId: randomUUID() };
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: payments,
        })
      ).statusCode,
    ).toBe(403);
    // Владельческая поверхность открывается отдельным правом billing:manage, без platform:admin.
    await database.prisma.accountPermission.create({
      data: { accountId: manager.id, permission: "billing:manage" },
    });
    const list = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: payments,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      operationRef: payments.operationId,
      result: { outcome: "payments", items: [], nextCursor: null },
    });
    const missing = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: {
        operation: "refunds.read",
        operationId: randomUUID(),
        purchaseRef: randomUUID(),
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(missing.json()).toMatchObject({ code: "not_found" });
    const decision = {
      operation: "refunds.decide",
      operationId: randomUUID(),
      purchaseRef: randomUUID(),
      amountKopecks: 0,
      basis: "compensation",
      recurring: "keep",
      reason: "Недопустимая сумма",
    };
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: decision,
        })
      ).statusCode,
    ).toBe(400);
    const grant = {
      operation: "grants.revoke",
      operationId: randomUUID(),
      grantRef: randomUUID(),
      expectedRevision: 1,
      reason: "Неизвестное основание",
    };
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/billing/admin",
          headers,
          payload: grant,
        })
      ).statusCode,
    ).toBe(404);
    // Чтение не занимает operationId, поэтому повторяется свободно и с другой нагрузкой.
    const repeated = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: { ...payments, limit: 5 },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual({
      operationRef: payments.operationId,
      result: { outcome: "payments", items: [], nextCursor: null },
    });
  });

  test("owner reads, records and re-reads one buyer state in the same shape", async () => {
    // Служебное поле однажды уже уехало в этот ответ разворотом переменной, поэтому форма
    // читается описанием: сверку выполняет сам `declaredServer` на каждом ответе ниже.
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const headers = {
      authorization: `Bearer ${await signToken({ subject: "billing-classifier-001", email: "classifier@example.test" })}`,
    };
    expect(
      (await server.inject({ method: "POST", url: "/accounts", headers }))
        .statusCode,
    ).toBe(201);
    await acceptCurrentTerms(server, headers);
    const owner = await database.prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: "billing-classifier-001",
        },
      },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: owner.id, permission: "billing:manage" },
    });
    const buyerHeaders = {
      authorization: `Bearer ${await signToken({ subject: "billing-buyer-001", email: "buyer@example.test" })}`,
    };
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/accounts",
          headers: buyerHeaders,
        })
      ).statusCode,
    ).toBe(201);
    await acceptCurrentTerms(server, buyerHeaders);
    const buyer = await database.prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: "billing-buyer-001",
        },
      },
    });

    const unknownRead = {
      operation: "grants.readClassification",
      operationId: randomUUID(),
      accountId: buyer.id,
    };
    const unknown = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: unknownRead,
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({
      operationRef: unknownRead.operationId,
      result: {
        outcome: "classification",
        value: {
          accountId: buyer.id,
          classification: "unknown",
          revision: 0,
          recurringAllowed: false,
        },
      },
    });

    const decision = {
      operation: "grants.classify",
      operationId: randomUUID(),
      accountId: buyer.id,
      expectedRevision: 0,
      classification: "confirmed_new",
      sourceRef: "tribute-import-2026-09",
      reason: "Подтверждён как новый покупатель",
      bridgeEnabled: false,
      tributeStopped: false,
    };
    const recorded = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: decision,
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toEqual({
      operationRef: decision.operationId,
      result: {
        outcome: "classification",
        value: {
          accountId: buyer.id,
          classification: "confirmed_new",
          revision: 1,
          recurringAllowed: true,
        },
      },
    });

    // Записанное решение и следующее чтение отвечают одной формой: иначе админка и кабинет
    // рассказывали бы о покупателе разное.
    const confirmedRead = { ...unknownRead, operationId: randomUUID() };
    const confirmed = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: confirmedRead,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({
      operationRef: confirmedRead.operationId,
      result: {
        outcome: "classification",
        value: {
          accountId: buyer.id,
          classification: "confirmed_new",
          revision: 1,
          recurringAllowed: true,
        },
      },
    });

    // Решение принимается от того состояния, которое владелец видел, а не от любого.
    const stale = await server.inject({
      method: "POST",
      url: "/billing/admin",
      headers,
      payload: { ...decision, operationId: randomUUID() },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers["content-type"]).toContain("application/problem+json");
    expect(stale.json()).toMatchObject({ code: "revision_conflict" });
  });

  test("Offer для прежних подписчиков Tribute требует и подтверждённый период, и приглашение", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    async function member(subject: string) {
      const headers = {
        authorization: `Bearer ${await signToken({ subject, email: `${subject}@example.test` })}`,
      };
      expect(
        (await server.inject({ method: "POST", url: "/accounts", headers }))
          .statusCode,
      ).toBe(201);
      await acceptCurrentTerms(server, headers);
      const account = await database.prisma.account.findUniqueOrThrow({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: issuer,
            logtoSubject: subject,
          },
        },
      });
      return { headers, accountId: account.id };
    }
    const owner = await member("tribute-owner-001");
    await database.prisma.accountPermission.create({
      data: { accountId: owner.accountId, permission: "platform:admin" },
    });
    const offerId = randomUUID();
    const optionId = randomUUID();
    const admin = (payload: Record<string, unknown>) =>
      server.inject({
        method: "POST",
        url: "/billing/admin",
        headers: owner.headers,
        payload: { operationId: randomUUID(), ...payload },
      });
    expect(
      (
        await admin({
          operation: "offers.save",
          value: {
            id: offerId,
            name: "Продление подписки Tribute",
            benefits: ["community", "materials", "support"],
            coverage: { productIds: [], materialIds: [], wholePlatform: true },
            eligibility: "former_tribute_subscribers",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await admin({
          operation: "paymentOptions.save",
          value: { id: optionId, offerId, months: 1, priceKopecks: 90_000 },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await admin({
          operation: "offers.publish",
          expectedRevision: 1,
          id: offerId,
        })
      ).statusCode,
    ).toBe(200);
    async function listed(headers?: Record<string, string>) {
      const response = await server.inject({
        method: "GET",
        url: "/billing/offers?mode=subscription&limit=100",
        ...(headers === undefined ? {} : { headers }),
      });
      expect(response.statusCode).toBe(200);
      return response
        .json<{ items: readonly { offer: { id: string } }[] }>()
        .items.some((item) => item.offer.id === offerId);
    }
    const quote = (headers: Record<string, string>) =>
      server.inject({
        method: "POST",
        url: "/accounts/current/billing/quote",
        headers,
        payload: {
          operationId: randomUUID(),
          paymentOptionId: optionId,
          optionRevision: 1,
        },
      });

    // Гость и Account без основания Offer не видят, а расчёт получает понятный отказ.
    expect(await listed()).toBe(false);
    const stranger = await member("tribute-stranger-001");
    expect(await listed(stranger.headers)).toBe(false);
    const refused = await quote(stranger.headers);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "not_eligible" });

    // Подтверждённый период Tribute — основание, в том числе после окончания периода.
    const subscriber = await member("tribute-subscriber-001");
    const source = await bindConfirmedTributeSource(
      database.prisma,
      subscriber.accountId,
    );
    expect(await listed(subscriber.headers)).toBe(false);
    expect((await quote(subscriber.headers)).statusCode).toBe(403);
    await seedPurchaseInvitation(
      database.prisma,
      subscriber.accountId,
      offerId,
    );
    expect(await listed(subscriber.headers)).toBe(true);
    expect((await quote(subscriber.headers)).statusCode).toBe(200);

    // Отозванный источник основанием не является.
    await source.revoke();
    expect(await listed(subscriber.headers)).toBe(false);
    expect((await quote(subscriber.headers)).statusCode).toBe(403);
  });

  test("владелец переключает поток продукта в каталоге, страница читает его без входа", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const headers = {
      authorization: `Bearer ${await signToken({ subject: "cohort-owner-001", email: "cohort@example.test" })}`,
    };
    expect(
      (await server.inject({ method: "POST", url: "/accounts", headers }))
        .statusCode,
    ).toBe(201);
    await acceptCurrentTerms(server, headers);
    const owner = await database.prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: "cohort-owner-001",
        },
      },
    });
    const productId = randomUUID();
    const save = (value: Record<string, unknown>, expectedRevision?: number) =>
      server.inject({
        method: "POST",
        url: "/billing/admin",
        headers,
        payload: {
          operation: "cohorts.save",
          operationId: randomUUID(),
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          value: { productId, ...value },
        },
      });
    const announcement = {
      name: "Поток 1",
      stage: "announcement",
      startsOn: "2026-10-20",
      nextEvent: "",
      priceAfterStartKopecks: null,
    };
    // Поток — часть каталога: без права billing:manage его не меняют.
    expect((await save(announcement)).statusCode).toBe(403);
    await database.prisma.accountPermission.create({
      data: { accountId: owner.id, permission: "billing:manage" },
    });
    const created = await save(announcement);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      result: {
        outcome: "catalog",
        value: { id: productId, revision: 1, archived: false },
      },
    });

    const read = async (requestHeaders: Record<string, string> = {}) => {
      const response = await server.inject({
        method: "GET",
        url: "/billing/cohorts",
        headers: requestHeaders,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      return response.json<{ items: { productId: string }[] }>().items;
    };
    expect((await read()).find((item) => item.productId === productId)).toEqual(
      {
        productId,
        guideId: productId,
        revision: 1,
        ...announcement,
      },
    );

    // Этапу, кроме «между потоками», нужна дата; между потоками нужно событие.
    expect(
      (await save({ ...announcement, stage: "preorder", startsOn: null }, 1))
        .statusCode,
    ).toBe(400);
    expect(
      (await save({ ...announcement, stage: "between", startsOn: null }, 1))
        .statusCode,
    ).toBe(400);
    // Устаревшая редакция не перезаписывает чужое переключение.
    expect(
      (await save({ ...announcement, stage: "preorder" })).statusCode,
    ).toBe(409);

    // Цена после старта — положительные копейки или null; без поля поток не сохраняется, чтобы
    // прежняя форма не стёрла цену молча.
    for (const priceAfterStartKopecks of [-100, 0, 399.5, "39900"])
      expect(
        (await save({ ...announcement, priceAfterStartKopecks }, 1)).statusCode,
      ).toBe(400);
    const { priceAfterStartKopecks: _omitted, ...withoutPrice } = announcement;
    expect((await save(withoutPrice, 1)).statusCode).toBe(400);

    // Предзаказ показывает зачёркнутую цену после старта; этап её не ограничивает.
    const preorder = {
      ...announcement,
      stage: "preorder",
      priceAfterStartKopecks: 3_990_000,
    };
    expect((await save(preorder, 1)).statusCode).toBe(200);
    expect((await read()).find((item) => item.productId === productId)).toEqual(
      {
        productId,
        guideId: productId,
        revision: 2,
        ...preorder,
      },
    );
    // Бот проверяет ответ целиком по закреплённому контракту: цена ему не приходит.
    const { priceAfterStartKopecks: _price, ...botPreorder } = preorder;
    expect(
      (await read({ "x-inside-domain-names": "products.v1" })).find(
        (item) => item.productId === productId,
      ),
    ).toEqual({ productId, revision: 2, ...botPreorder });

    const between = {
      name: "Поток 2",
      stage: "between",
      startsOn: null,
      nextEvent: "эфир 15 декабря",
      priceAfterStartKopecks: null,
    };
    expect((await save(between, 2)).statusCode).toBe(200);
    expect((await read()).find((item) => item.productId === productId)).toEqual(
      {
        productId,
        guideId: productId,
        revision: 3,
        ...between,
      },
    );
  });

  test("HTTP и MCP отклоняют межсемейный конфликт до применения и узнают одинаковый повтор", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const headers = {
      authorization: `Bearer ${await signToken({ subject: "owner-command-race", email: "race@example.test" })}`,
    };
    expect(
      (await server.inject({ method: "POST", url: "/accounts", headers }))
        .statusCode,
    ).toBe(201);
    await acceptCurrentTerms(server, headers);
    const owner = await database.prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: "owner-command-race",
        },
      },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: owner.id, permission: "billing:manage" },
    });
    const operations = app.get(BillingOperations);
    const mcp = new McpServer({ name: "billing-command-test", version: "1" });
    registerBillingTools(mcp, { accountId: owner.id, billing: operations });
    const client = new Client({ name: "billing-command-client", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    let release!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pricing = app.get(BillingPricing);
    const manage = pricing.manage.bind(pricing);
    const gate = vi
      .spyOn(pricing, "manage")
      .mockImplementation(async (actor, input) => {
        enter();
        await resume;
        return manage(actor, input);
      });
    const command = {
      operation: "offers.save",
      operationId: randomUUID(),
      value: {
        id: randomUUID(),
        name: "Тариф HTTP/MCP",
        benefits: ["community"],
      },
    };
    let saving: ReturnType<typeof server.inject> | undefined;
    try {
      await Promise.all([
        mcp.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      saving = server.inject({
        method: "POST",
        url: "/billing/admin",
        headers,
        payload: command,
      });
      await entered;
      const arguments_ = {
        operationId: command.operationId,
        accountId: owner.id,
        expectedRevision: 0,
        classification: "confirmed_new",
        sourceRef: "synthetic-race",
        reason: "Межсемейная гонка",
        bridgeEnabled: false,
        tributeStopped: false,
      };
      const conflict = await client.callTool({
        name: "billing_grants_classify",
        arguments: arguments_,
      });
      expect(conflict).toMatchObject({
        isError: true,
        structuredContent: { ok: false, error: { code: "operation_conflict" } },
      });
      const httpConflict = await server.inject({
        method: "POST",
        url: "/billing/admin",
        headers,
        payload: { operation: "grants.classify", ...arguments_ },
      });
      expect(httpConflict.statusCode).toBe(409);
      expect(httpConflict.json()).toMatchObject({ code: "operation_conflict" });
      release();
      const saved = await saving;
      expect(saved.statusCode).toBe(200);
      const repeated = await client.callTool({
        name: "billing_offers_save",
        arguments: {
          operationId: command.operationId,
          value: command.value,
        },
      });
      expect(repeated.structuredContent).toEqual({
        ok: true,
        ...saved.json<Record<string, unknown>>(),
      });
      const state = await operations.execute(owner.id, {
        operation: "grants.readClassification",
        operationId: randomUUID(),
        accountId: owner.id,
      });
      expect(state).toMatchObject({
        ok: true,
        result: {
          outcome: "classification",
          value: { classification: "unknown" },
        },
      });
    } finally {
      release();
      gate.mockRestore();
      if (saving !== undefined) await saving;
      await client.close();
      await mcp.close();
    }
  });

  async function signToken(
    overrides: {
      readonly subject?: string;
      readonly clientId?: string;
      readonly email?: string;
    } = {},
  ): Promise<string> {
    // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: overrides.email ?? "member@example.test",
      ...(overrides.clientId === undefined
        ? {}
        : { client_id: overrides.clientId }),
    })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(overrides.subject ?? "human-api-001")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});
