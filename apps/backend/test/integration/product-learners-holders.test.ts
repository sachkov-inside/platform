import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { assembleProductMaterialReading } from "../../src/modules/materials/index.js";
import { listProductHolders } from "../../src/modules/product-learners/features/list-product-holders/list-product-holders.js";
import { PublishedProductComposition } from "../../src/modules/products/index.js";
import { ReadingActivity } from "../../src/modules/reading-activity/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { declaredServer } from "../support/declared-api.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  grantProductFixture,
  revokeProductFixture,
} from "./setup/product-access.js";
import { createQueryEventClient } from "./setup/query-events.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";
const author = "17181000-0000-4000-8000-000000000001";
const topicId = "17181000-0000-4000-8000-000000000002";
const holder = (n: number) =>
  `17182000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Holder = {
  accountId: string;
  access: "active" | "revoked";
  firstIssuedAt: string | null;
  revision: number;
  learning: {
    readCount: number;
    totalCount: number;
    startedAt: string | null;
    lastActivityAt: string | null;
  };
};
type Page = { items: Holder[]; nextCursor: string | null };

describe("Product holders for the admin (#1718)", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let database: TestDatabase;
  let jwksServer: Server;
  const http = () => declaredServer(app.getHttpAdapter().getInstance());
  let materials: ReturnType<typeof assembleMaterials>;
  const bearers = new Map<string, string>();

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
        IDENTITY_EMAIL_FINGERPRINT_KEY: "product-holders-test-fingerprint",
      }),
      { logger: false },
    );
    await app.init();

    await http().ready();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Holders", slug: "holders" },
    });
    materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === author },
    });
    for (const [subject, permissions] of [
      ["billing-owner", ["billing:manage"]],
      ["catalogue-owner", ["billing:manage", "materials:manage"]],
      ["materials-author", ["materials:manage"]],
      ["plain-member", []],
    ] as const) {
      const bearer = await signToken(subject, `${subject}@example.test`);
      expect(
        (
          await http().inject({
            method: "POST",
            url: "/accounts",
            headers: { authorization: `Bearer ${bearer}` },
          })
        ).statusCode,
      ).toBe(201);
      const account = await database.prisma.account.findFirstOrThrow({
        where: { logtoSubject: subject },
      });
      for (const permission of permissions)
        await database.prisma.accountPermission.create({
          data: { accountId: account.id, permission },
        });
      bearers.set(subject, bearer);
    }
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

  function holders(
    subject: string,
    productId: string,
    query: Record<string, string | string[]> = {},
  ) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      for (const item of Array.isArray(value) ? value : [value])
        search.append(key, item);
    const suffix = search.size === 0 ? "" : `?${search.toString()}`;
    return http().inject({
      method: "GET",
      url: `/admin/products/${productId}/holders${suffix}`,
      headers: { authorization: `Bearer ${bearers.get(subject) ?? ""}` },
    });
  }
  async function page(
    productId: string,
    query: Record<string, string | string[]> = {},
  ) {
    const response = await holders("billing-owner", productId, query);
    expect(response.statusCode).toBe(200);
    return response.json<Page>();
  }
  async function product() {
    const id = randomUUID();
    await database.prisma.product.create({
      data: { id, slug: `holders-${id}`, name: "Holders product" },
    });
    return id;
  }
  async function programmeMaterial(productId: string) {
    const created = await materials.authoring.createDraft({
      actor: author,
      idempotencyKey: randomUUID(),
      metadata: {
        title: `Lesson ${randomUUID()}`,
        summary: "Holders",
        topicId,
        formatId: "note",
        access: "free",
        tagIds: [],
        difficulty: null,
        outcomes: [],
        productIds: [productId],
      },
      body: representativeDocument("Lesson."),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({
      actor: author,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion,
      publicationState: "published",
    });
    if (!published.ok) throw new Error(published.error.code);
    const last = await database.prisma.productProgrammePlacement.aggregate({
      where: { productId },
      _max: { ordinal: true },
    });
    await database.prisma.productProgrammePlacement.create({
      data: {
        id: randomUUID(),
        productId,
        materialId: published.value.materialId,
        chapterId: null,
        ordinal: (last._max.ordinal ?? 0) + 1,
      },
    });
    return published.value.materialId;
  }
  async function issuedAt(accountId: string, productId: string, at: string) {
    await database.prisma.productAccess.update({
      where: { accountId_productId: { accountId, productId } },
      data: { firstIssuedAt: new Date(at) },
    });
  }

  test("billing:manage reads holders and their learning; other roles are refused, not given an empty list", async () => {
    const productId = await product();
    const lesson = await programmeMaterial(productId);
    await programmeMaterial(productId);
    await grantProductFixture(database.prisma, holder(1), productId);
    await issuedAt(holder(1), productId, "2026-10-05T08:00:00.000Z");
    const reading = app.get(ReadingActivity);
    expect(
      await reading.setReadingState({
        accountId: holder(1),
        materialId: lesson,
        isRead: true,
        expectedVersion: 0,
        commandId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    await database.prisma.readingMaterialVisit.create({
      data: {
        accountId: holder(1),
        materialId: lesson,
        firstOpenedAt: new Date("2026-10-06T09:00:00.000Z"),
        lastOpenedAt: new Date("2026-10-07T21:30:00.000Z"),
      },
    });
    await database.prisma.productLearningStarted.create({
      data: {
        accountId: holder(1),
        productId,
        startedAt: new Date("2026-10-06T09:00:00.000Z"),
      },
    });

    expect(await page(productId)).toEqual({
      items: [
        {
          accountId: holder(1),
          access: "active",
          firstIssuedAt: "2026-10-05T08:00:00.000Z",
          revision: 1,
          learning: {
            readCount: 1,
            totalCount: 2,
            startedAt: "2026-10-06T09:00:00.000Z",
            lastActivityAt: "2026-10-07T21:30:00.000Z",
          },
        },
      ],
      nextCursor: null,
    });
    const body = JSON.stringify(await page(productId));
    expect(body).not.toContain("@example.test");

    for (const subject of ["materials-author", "plain-member"]) {
      const refused = await holders(subject, productId);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ code: "forbidden" });
      // The refusal does not reveal whether a Product exists.
      expect((await holders(subject, randomUUID())).statusCode).toBe(403);
      // Nor whether the request was well formed: the right comes before the input.
      expect((await holders(subject, "not-a-product")).statusCode).toBe(403);
      expect(
        (await holders(subject, productId, { limit: "51" })).statusCode,
      ).toBe(403);
      expect(
        (await holders(subject, productId, { unknown: "1" })).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await http().inject({
          method: "GET",
          url: `/admin/products/${productId}/holders`,
        })
      ).statusCode,
    ).toBe(401);

    const unknown = await holders("billing-owner", randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: "product_not_found" });
    expect((await holders("billing-owner", "not-a-product")).statusCode).toBe(
      400,
    );
    for (const query of [
      { limit: "51" },
      { limit: "0" },
      { limit: "ten" },
      { access: "lapsed" },
      { accountIds: "not-an-account" },
      { accountIds: Array.from({ length: 51 }, (_, n) => holder(100 + n)) },
      { unexpected: "1" },
    ])
      expect(
        (await holders("billing-owner", productId, query)).statusCode,
      ).toBe(400);

    // An empty Product is a fact, not an error.
    expect(await page(await product())).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  test("filters by access, orders recent first, pre-checks chosen people and binds the cursor to its scope", async () => {
    const productId = await product();
    await programmeMaterial(productId);
    for (let n = 11; n <= 14; n += 1)
      await grantProductFixture(database.prisma, holder(n), productId);
    await issuedAt(holder(11), productId, "2026-10-01T10:00:00.000Z");
    await issuedAt(holder(12), productId, "2026-10-04T10:00:00.000Z");
    await issuedAt(holder(13), productId, "2026-10-03T10:00:00.000Z");
    await issuedAt(holder(14), productId, "2026-10-02T10:00:00.000Z");
    await revokeProductFixture(database.prisma, `${holder(13)}:${productId}`);

    const walk = async (query: Record<string, string | string[]>) => {
      const rows: Holder[] = [];
      let cursor: string | null = null;
      do {
        const next: Page = await page(productId, {
          ...query,
          limit: "1",
          ...(cursor === null ? {} : { cursor }),
        });
        rows.push(...next.items);
        cursor = next.nextCursor;
        expect(rows.length).toBeLessThanOrEqual(4);
      } while (cursor !== null);
      return rows.map((row) => [row.accountId, row.access]);
    };
    expect(await walk({})).toEqual([
      [holder(12), "active"],
      [holder(13), "revoked"],
      [holder(14), "active"],
      [holder(11), "active"],
    ]);
    expect(await walk({ access: "active" })).toEqual([
      [holder(12), "active"],
      [holder(14), "active"],
      [holder(11), "active"],
    ]);
    expect(await walk({ access: "revoked" })).toEqual([
      [holder(13), "revoked"],
    ]);
    // The pre-check of a grant: who of the chosen people already has or had access.
    const chosen = [holder(11), holder(13), holder(99)];
    expect(await walk({ accountIds: chosen })).toEqual([
      [holder(13), "revoked"],
      [holder(11), "active"],
    ]);
    expect((await page(productId, { accountIds: holder(99) })).items).toEqual(
      [],
    );
    expect((await page(productId)).items).toHaveLength(4);

    const first = await page(productId, { limit: "1" });
    const cursor = first.nextCursor;
    if (cursor === null) throw new Error("Expected a continuation");
    const other = await product();
    for (const [target, query] of [
      [productId, { access: "active" }],
      [productId, { accountIds: chosen }],
      [other, {}],
    ] as const)
      expect(
        (await holders("billing-owner", target, { ...query, cursor }))
          .statusCode,
      ).toBe(400);
    // A cursor rewritten to widen its scope (drop the Product) no longer matches the request.
    const decoded = z
      .looseObject({ scope: z.looseObject({ productId: z.uuid() }) })
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    const forged = Buffer.from(
      JSON.stringify({
        ...decoded,
        scope: { ...decoded.scope, productId: null },
      }),
    ).toString("base64url");
    expect(
      (await holders("billing-owner", productId, { cursor: forged }))
        .statusCode,
    ).toBe(400);
    expect(
      (await holders("billing-owner", productId, { cursor: `${cursor}x` }))
        .statusCode,
    ).toBe(400);
    expect(
      (await holders("billing-owner", productId, { cursor: "a:b" })).statusCode,
    ).toBe(400);
    expect(
      (await holders("materials-author", productId, { cursor })).statusCode,
    ).toBe(403);
  });

  test("a page costs the same statements for one holder and for fifty", async () => {
    const productId = await product();
    await programmeMaterial(productId);
    const observer = createQueryEventClient(database.url);
    try {
      const owner = await database.prisma.account.findFirstOrThrow({
        where: { logtoSubject: "billing-owner" },
      });
      const accounts = assembleAccounts({
        prisma: observer.prisma,
        emailFingerprintKey: "product-holders-cost-fingerprint-key",
      });
      const dependencies = {
        accounts,
        grants: assembleAccessGrants({ prisma: observer.prisma, accounts }),
        reading: new ReadingActivity({
          prisma: observer.prisma,
          materialContent: materials.materialContent,
          contentAccess: {
            authorize: () => Promise.reject(new Error("unused")),
            checkProductAccess: () => Promise.reject(new Error("unused")),
          },
          composition: new PublishedProductComposition(
            observer.prisma,
            assembleProductMaterialReading(observer.prisma),
          ),
        }),
      };
      const measure = async (limit: number) => {
        const { result, statements } = await observer.measure(() =>
          listProductHolders(dependencies, owner.id, { productId, limit }),
        );
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) throw new Error(result.error.code);
        expect(result.value.items).toHaveLength(limit);
        return statements.length;
      };
      await grantProductFixture(database.prisma, holder(200), productId);
      const one = await measure(1);
      for (let n = 201; n < 250; n += 1)
        await grantProductFixture(database.prisma, holder(n), productId);
      expect(await measure(50)).toBe(one);
    } finally {
      await observer.prisma.$disconnect();
    }
  });

  test("the products list carries holder counts only for an actor with billing:manage", async () => {
    const productId = await product();
    await grantProductFixture(database.prisma, holder(300), productId);
    await grantProductFixture(database.prisma, holder(301), productId);
    const list = async (subject: string) => {
      const response = await http().inject({
        method: "GET",
        url: "/authoring/collections?kind=product",
        headers: { authorization: `Bearer ${bearers.get(subject) ?? ""}` },
      });
      expect(response.statusCode).toBe(200);
      return response
        .json<{ id: string; holderCount: number | null }[]>()
        .find((row) => row.id === productId)?.holderCount;
    };
    expect(await list("catalogue-owner")).toBe(2);
    expect(await list("materials-author")).toBeNull();
  });

  async function signToken(subject: string, email: string): Promise<string> {
    // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({ inside_verified_email: email })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});
