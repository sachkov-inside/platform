import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  AccountGuard,
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import { verifiedAccountIdentity } from "../../src/modules/accounts/facets/accounts/verified-logto-identity.js";
import { ProductWaitlists } from "../../src/modules/sales-funnel/facets/product-waitlists/product-waitlists.js";
import { ProductWaitlistController } from "../../src/modules/sales-funnel/features/manage-product-waitlist/manage-product-waitlist.controller.js";
import { ReadFunnelReportController } from "../../src/modules/sales-funnel/features/read-funnel-report/read-funnel-report.controller.js";
import { SalesFunnel } from "../../src/modules/sales-funnel/facets/sales-funnel/sales-funnel.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { ProductOutlines } from "../../src/modules/materials/index.js";
import { MaterialFirstOpens } from "../../src/modules/reading-activity/index.js";
import {
  BillingProductSales,
  BillingSurveyRespondentSales,
} from "../../src/modules/billing/index.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
let db: TestDatabase;
let app: NestFastifyApplication;
const issuer = "https://waitlist-http.test";
const productId = randomUUID();
const intakeId = randomUUID();
const period = { from: "2030-03-01T00:00:00Z", to: "2030-04-01T00:00:00Z" };
beforeAll(async () => {
  db = await createMigratedTestDatabase();
  await bootstrapOwnerAccount(
    db.prisma,
    { issuer, subject: "owner" },
    "billing:manage",
  );
  const member = await bootstrapOwnerAccount(
    db.prisma,
    { issuer, subject: "member" },
    "materials:manage",
  );
  await bootstrapOwnerAccount(
    db.prisma,
    { issuer, subject: "other" },
    "materials:manage",
  );
  await db.prisma.product.create({
    data: { id: productId, slug: "ai-engineering", name: "AI Engineering" },
  });
  await db.prisma.productWaitlistIntake.create({
    data: { id: intakeId, productId, name: "Следующий набор", accepting: true },
  });
  await db.prisma.telegramAccountLinkState.create({
    data: {
      accountId: member.accountId,
      linkRef: randomUUID(),
      revision: 1,
      principalRef: "http-principal",
      identityRef: "http-identity",
      updatedAt: new Date("2030-03-01T00:00:00Z"),
    },
  });
  const accounts = assembleAccounts({
    prisma: db.prisma,
    emailFingerprintKey: "waitlist-http-synthetic-fingerprint-secret",
  });
  const links = new TelegramAccountLinks(db.prisma);
  const dependencies = {
    prisma: db.prisma,
    rights: assembleAccountRights({
      prisma: db.prisma,
      clock: () => new Date("2030-03-05T12:00:00Z"),
    }),
    links,
    clock: () => new Date("2030-03-05T00:00:00Z"),
  };
  const funnel = new SalesFunnel({
    ...dependencies,
    accounts,
    outlines: new ProductOutlines(db.prisma),
    firstOpens: new MaterialFirstOpens(db.prisma),
    sales: new BillingProductSales(db.prisma),
    surveyRespondents: new BillingSurveyRespondentSales(db.prisma),
  });
  @Module({
    controllers: [ProductWaitlistController, ReadFunnelReportController],
    providers: [
      AccountGuard,
      { provide: ACCOUNTS, useValue: accounts },
      {
        provide: LOGTO_ACCESS_TOKEN_VERIFIER,
        useValue: {
          verifyAccount: (token: unknown) =>
            Promise.resolve(
              typeof token === "string" &&
                ["owner", "member", "other"].includes(token)
                ? {
                    ok: true,
                    identity: verifiedAccountIdentity({
                      issuer,
                      subject: token,
                    }),
                    expiresAt: 1_900_000_000,
                    scopes: [],
                  }
                : { ok: false, error: { code: "invalid_proof" } },
            ),
        },
      },
      {
        provide: ProductWaitlists,
        useValue: new ProductWaitlists(dependencies),
      },
      { provide: SalesFunnel, useValue: funnel },
      { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  })
  // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete fixture module.
  class FixtureModule {}
  app = await NestFactory.create<NestFastifyApplication>(
    FixtureModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  await db.dispose();
});
async function request(
  method: "GET" | "POST",
  url: string,
  actor?: string,
  payload?: object,
) {
  const response = await app.inject({
    method,
    url,
    ...(actor === undefined
      ? {}
      : { headers: { authorization: `Bearer ${actor}` } }),
    ...(payload === undefined ? {} : { payload }),
  });
  assertDeclaredResponse({
    method,
    url,
    status: response.statusCode,
    body: () => response.json(),
  });
  expect(response.headers["cache-control"]).toBe("private, no-store");
  return response;
}
test("public intake discloses no membership/count; protected reads/writes and report require authentication", async () => {
  const intake = await request("GET", `/product-waitlists/${productId}/intake`);
  expect(intake.json()).toEqual({ intakeId, name: "Следующий набор" });
  expect(
    (await request("GET", `/product-waitlists/${productId}/membership`))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await request("POST", "/product-waitlists/join", undefined, {
        intakeId,
        operationId: randomUUID(),
        source: null,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await request(
        "GET",
        `/sales-funnel/report?from=${period.from}&to=${period.to}`,
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await request(
        "GET",
        `/sales-funnel/report?from=${period.from}&to=${period.to}`,
        "member",
      )
    ).statusCode,
  ).toBe(403);
});
test("authenticated Account is authoritative, malicious Account input is rejected, and report counts actual membership", async () => {
  expect(
    (
      await request("POST", "/product-waitlists/join", "member", {
        intakeId,
        operationId: randomUUID(),
        source: "youtube",
        accountId: randomUUID(),
      })
    ).statusCode,
  ).toBe(400);
  const joined = await request("POST", "/product-waitlists/join", "member", {
    intakeId,
    operationId: randomUUID(),
    source: "youtube",
  });
  expect(joined.statusCode).toBe(200);
  expect(joined.json()).toMatchObject({ active: true });
  expect(
    (
      await request(
        "GET",
        `/product-waitlists/${productId}/membership`,
        "other",
      )
    ).json(),
  ).toMatchObject({ active: false });
  const report = await request(
    "GET",
    `/sales-funnel/report?from=${period.from}&to=${period.to}&productId=${productId}`,
    "owner",
  );
  expect(report.statusCode).toBe(200);
  expect(report.json()).toMatchObject({
    waitlist: {
      active: 1,
      joined: 1,
      withdrawn: 0,
      sources: [{ source: "youtube", active: 1 }],
    },
  });
  expect(
    (
      await request("POST", "/product-waitlists/withdraw", "other", {
        intakeId,
      })
    ).json(),
  ).toMatchObject({ active: false });
  expect(
    (
      await request(
        "GET",
        `/product-waitlists/${productId}/membership`,
        "member",
      )
    ).json(),
  ).toMatchObject({ active: true });
});
