import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import type { PlatformPrisma } from "../../src/infrastructure/prisma/index.js";
import { assemblePaymentsSearchGroup } from "../../src/modules/authoring-search/adapters/billing/payments-search-group.js";
import { assemblePeopleSearchGroup } from "../../src/modules/authoring-search/adapters/people/people-search-group.js";
import { assembleMaterialsSearchGroup } from "../../src/modules/authoring-search/adapters/materials/materials-search-group.js";
import { assembleProductsSearchGroup } from "../../src/modules/authoring-search/adapters/products/products-search-group.js";
import { assembleAuthoringSearch } from "../../src/modules/authoring-search/features/search-authoring/search-authoring.js";
import type { AuthoringSearchGroup } from "../../src/modules/authoring-search/ports/authoring-search-group.js";
import {
  AccountDirectory,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import { fingerprintEmail } from "../../src/modules/accounts/shared/account-input.js";
import {
  BillingPaymentSearch,
  PAYMENT_SEARCH_ACCOUNT_LIMIT,
} from "../../src/modules/billing/index.js";
import { assembleProductMaterials } from "../../src/modules/materials/index.js";
import { PeopleDirectory } from "../../src/modules/people-directory/index.js";
import {
  assembleProductAuthoring,
  ProductDiscovery,
} from "../../src/modules/products/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";
import {
  commerceValue,
  createProductCommerceFixture,
} from "./setup/product-commerce.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { unreadPeopleOwners } from "./setup/people-owners.js";
import { createQueryEventClient } from "./setup/query-events.js";

registerFixedClock();

/** The registry of the API process: Products from Products, Materials from Materials. */
function searchGroups(
  prisma: PlatformPrisma,
  canManage: (actor: string) => boolean,
): readonly [AuthoringSearchGroup, AuthoringSearchGroup] {
  const authorPolicy = { canManage };
  const products = assembleProductAuthoring({
    prisma,
    authorPolicy,
    materials: assembleProductMaterials(prisma, new ProductDiscovery(prisma)),
    loadCovers: () => Promise.resolve(new Map()),
  });
  const { authoring } = assembleMaterials({ prisma, authorPolicy });
  return [
    assembleProductsSearchGroup(products),
    assembleMaterialsSearchGroup(authoring),
  ];
}

const emailFingerprintKey = "product-buyer-test-fingerprint-key-000000";

/** The people directory of the API process, over the same Accounts as the Payments group. */
function peopleDirectory(
  prisma: PlatformPrisma,
  accounts: ReturnType<typeof assembleAccounts>,
): PeopleDirectory {
  return new PeopleDirectory({
    ...unreadPeopleOwners,
    accounts,
    directory: new AccountDirectory({
      prisma,
      protection: undefined,
      emailFingerprintKey,
    }),
    telegram: new TelegramAccountLinks(prisma),
  });
}

const manager = "97000000-0000-4000-8000-000000000001";
const topicId = "97000000-0000-4000-8000-000000000002";
// Ids fix the tie-break order of Products that share a name.
const productIds = Array.from(
  { length: 7 },
  (_, index) =>
    `97000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
);

/**
 * The authoring search over People (#1721), Products and Materials (#1720), as an operation and
 * over HTTP.
 */
describe("Authoring search", () => {
  let database: TestDatabase;
  let identity: TestIdentityIssuer;
  let app: NestFastifyApplication;
  let server: DeclaredServer;
  const materialIds: string[] = [];

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Search topic", slug: "search-topic" },
    });
    // Seven Products match «search product»: one only by its slug, one archived.
    await database.prisma.product.createMany({
      data: [
        { id: productIds[0] ?? "", name: "Search product B", slug: "spb" },
        {
          id: productIds[1] ?? "",
          name: "Search product A",
          slug: "spa",
          archivedAt: new Date("2026-08-01T10:00:00.000Z"),
        },
        { id: productIds[2] ?? "", name: "Search product C", slug: "spc" },
        { id: productIds[3] ?? "", name: "Search product C", slug: "spc-2" },
        { id: productIds[4] ?? "", name: "Search product E", slug: "spe" },
        { id: productIds[5] ?? "", name: "Search product F", slug: "spf" },
        {
          id: productIds[6] ?? "",
          name: "Renamed path",
          slug: "search-product-by-slug",
        },
        { id: randomUUID(), name: "Unrelated catalog", slug: "unrelated" },
      ],
    });
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
    });
    for (const index of [1, 2, 3, 4, 5, 6]) {
      const created = await authoring.createDraft({
        actor: manager,
        idempotencyKey: `authoring-search-${String(index)}`,
        metadata: {
          title: index === 6 ? null : `Search corpus ${String(index)}`,
          summary: index === 6 ? "Untitled search corpus draft" : null,
          access: "free",
          topicId: index === 1 ? null : topicId,
          formatId: "guide",
          tagIds: [],
          difficulty: null,
          outcomes: [],
          productIds: [],
        },
        body: representativeDocument(`Search corpus ${String(index)}`),
      });
      if (!created.ok) throw new Error(created.error.code);
      materialIds.push(created.value.materialId);
    }
    await Promise.all(
      materialIds.map((materialId, index) =>
        database.prisma.material.update({
          data: {
            updatedAt: new Date(`2026-08-0${String(index + 1)}T10:00:00.000Z`),
          },
          where: { id: materialId },
        }),
      ),
    );

    identity = await startTestIdentityIssuer({
      issuer: "https://identity.authoring-search.test/oidc",
      audience: "https://api.authoring-search.test",
    });
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: identity.issuer,
        LOGTO_AUDIENCE: identity.audience,
        LOGTO_JWKS_URL: identity.jwksUrl,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "authoring-search-fingerprint-key",
      }),
      { logger: false },
    );
    await app.init();
    server = declaredServer(app.getHttpAdapter().getInstance());
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await identity.close();
  });

  const expectedProducts = [
    { id: productIds[1], name: "Search product A", archived: true },
    { id: productIds[0], name: "Search product B", archived: false },
    { id: productIds[2], name: "Search product C", archived: false },
    { id: productIds[3], name: "Search product C", archived: false },
    { id: productIds[4], name: "Search product E", archived: false },
  ];

  test("a manager finds at most five Products by name or slug, archived ones flagged, and the newest matching Materials with their Topic", async () => {
    const search = assembleAuthoringSearch(
      searchGroups(database.prisma, (actor) => actor === manager),
    );

    expect(await search.search(manager, "  search   product ")).toEqual({
      ok: true,
      value: {
        groups: [
          { kind: "products", state: "ready", items: expectedProducts },
          { kind: "materials", state: "ready", items: [] },
        ],
      },
    });
    expect(await search.search(manager, "by-slug")).toMatchObject({
      ok: true,
      value: {
        groups: [
          {
            kind: "products",
            items: [{ id: productIds[6], name: "Renamed path" }],
          },
          { kind: "materials", items: [] },
        ],
      },
    });
    expect(await search.search(manager, "SEARCH CORPUS")).toEqual({
      ok: true,
      value: {
        groups: [
          { kind: "products", state: "ready", items: [] },
          {
            kind: "materials",
            state: "ready",
            items: [
              {
                id: materialIds[5],
                title: null,
                publicationState: "draft",
                topic: "Search topic",
              },
              ...[4, 3, 2, 1].map((index) => ({
                id: materialIds[index],
                title: `Search corpus ${String(index + 1)}`,
                publicationState: "draft",
                topic: "Search topic",
              })),
            ],
          },
        ],
      },
    });
    expect(await search.search(manager, "search corpus 1")).toMatchObject({
      ok: true,
      value: {
        groups: [
          { kind: "products", items: [] },
          { kind: "materials", items: [{ id: materialIds[0], topic: null }] },
        ],
      },
    });
  });

  test("an account without materials:manage is refused rather than answered with empty groups", async () => {
    const search = assembleAuthoringSearch(
      searchGroups(database.prisma, () => false),
    );
    expect(await search.search(manager, "search product")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test("a failing group answers unavailable while the other group still answers", async () => {
    const [products, materials] = searchGroups(database.prisma, () => true);
    const failing = assembleAuthoringSearch([
      products,
      {
        kind: "materials",
        search: () =>
          Promise.resolve({
            ok: false,
            error: { code: "dependency_unavailable", retryable: true },
          }),
      },
    ]);
    expect(await failing.search(manager, "search product")).toEqual({
      ok: true,
      value: {
        groups: [
          { kind: "products", state: "ready", items: expectedProducts },
          { kind: "materials", state: "unavailable" },
        ],
      },
    });
    const throwing = assembleAuthoringSearch([
      {
        kind: "products",
        search: () => Promise.reject(new Error("search index offline")),
      },
      materials,
    ]);
    expect(await throwing.search(manager, "search corpus 1")).toMatchObject({
      ok: true,
      value: {
        groups: [
          { kind: "products", state: "unavailable" },
          {
            kind: "materials",
            state: "ready",
            items: [{ id: materialIds[0] }],
          },
        ],
      },
    });
    // A group the actor may not read is omitted, the readable one still answers.
    const partial = assembleAuthoringSearch([
      {
        kind: "products",
        search: () =>
          Promise.resolve({ ok: false, error: { code: "forbidden" } }),
      },
      materials,
    ]);
    expect(await partial.search(manager, "search corpus 1")).toMatchObject({
      ok: true,
      value: { groups: [{ kind: "materials", state: "ready" }] },
    });
  });

  test("a People Directory refusal of a valid search text is a recorded defect: the group answers unavailable", async () => {
    const [products] = searchGroups(database.prisma, () => true);
    const search = assembleAuthoringSearch([
      assemblePeopleSearchGroup({
        searchPeople: () =>
          Promise.resolve({ ok: false, error: { code: "invalid_request" } }),
      }),
      products,
    ]);
    expect(await search.search(manager, "search product")).toEqual({
      ok: true,
      value: {
        groups: [
          { kind: "people", state: "unavailable" },
          { kind: "products", state: "ready", items: expectedProducts },
        ],
      },
    });
  });

  test("an empty, blank or overlong query is malformed", async () => {
    const search = assembleAuthoringSearch(
      searchGroups(database.prisma, () => true),
    );
    for (const query of ["", "   ", "x".repeat(161), undefined, ["a", "b"]])
      expect(await search.search(manager, query)).toEqual({
        ok: false,
        error: { code: "invalid_request_shape" },
      });
  });

  test("over HTTP the manager reads the groups, another account gets 403 and a blank query 400", async () => {
    const managerHeaders = await signedIn("materials:manage");
    const billingHeaders = await signedIn("billing:manage");
    const url = (query: string) =>
      `/authoring/search?query=${encodeURIComponent(query)}`;

    expect(
      (await server.inject({ method: "GET", url: url("search product") }))
        .statusCode,
    ).toBe(401);
    const found = await server.inject({
      method: "GET",
      url: url("search product"),
      headers: managerHeaders,
    });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toContain("no-store");
    expect(found.json()).toEqual({
      groups: [
        { kind: "products", state: "ready", items: expectedProducts },
        { kind: "materials", state: "ready", items: [] },
      ],
    });
    // billing:manage reads only the People and Payments groups; this API has no Telegram to search
    // names, so «search product» finds no person and no payment of a person.
    const billing = await server.inject({
      method: "GET",
      url: url("search product"),
      headers: billingHeaders,
    });
    expect(billing.statusCode).toBe(200);
    expect(billing.json()).toEqual({
      groups: [
        {
          kind: "people",
          state: "ready",
          items: [],
          partial: true,
          truncated: false,
        },
        {
          kind: "payments",
          state: "ready",
          items: [],
          personSearch: "name_unavailable",
        },
      ],
    });
    const denied = await server.inject({
      method: "GET",
      url: url("search product"),
      headers: await signedIn(null),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "forbidden" });
    for (const malformed of [
      "/authoring/search",
      url("  "),
      url("x".repeat(161)),
    ]) {
      const response = await server.inject({
        method: "GET",
        url: malformed,
        headers: managerHeaders,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "invalid_request_shape" });
    }
  });

  test("over HTTP the People group comes first for billing:manage, finds a person by ID and exact email, and is omitted without the right", async () => {
    const subject = `authoring-search-person-${randomUUID()}`;
    await server.inject({
      method: "POST",
      url: "/accounts",
      headers: {
        authorization: `Bearer ${await identity.sign(subject, {
          inside_verified_email: "Searched.Person@example.test",
        })}`,
      },
    });
    const person = await database.prisma.account.findFirstOrThrow({
      where: { logtoSubject: subject },
    });
    const both = await signedIn("billing:manage", "materials:manage");
    const url = (query: string) =>
      `/authoring/search?query=${encodeURIComponent(query)}`;
    const expectedPerson = {
      accountId: person.id,
      displayName: null,
      username: null,
      email: null,
      contactsState: "complete",
    };
    for (const query of [
      person.id.toUpperCase(),
      "searched.person@example.test",
    ]) {
      const found = await server.inject({
        method: "GET",
        url: url(query),
        headers: both,
      });
      expect(found.statusCode).toBe(200);
      expect(found.json()).toEqual({
        groups: [
          {
            kind: "people",
            state: "ready",
            items: [expectedPerson],
            partial: false,
            truncated: false,
          },
          { kind: "products", state: "ready", items: [] },
          { kind: "materials", state: "ready", items: [] },
          {
            kind: "payments",
            state: "ready",
            items: [],
            personSearch: "available",
          },
        ],
      });
    }
    const manager = await server.inject({
      method: "GET",
      url: url("searched.person@example.test"),
      headers: await signedIn("materials:manage"),
    });
    expect(manager.statusCode).toBe(200);
    expect(manager.json()).toEqual({
      groups: [
        { kind: "products", state: "ready", items: [] },
        { kind: "materials", state: "ready", items: [] },
      ],
    });
    expect(manager.body).not.toContain(person.id);
  });

  test("over HTTP the Materials list accepts Topic and format filters and refuses malformed ones", async () => {
    const managerHeaders = await signedIn("materials:manage");
    const listed = await server.inject({
      method: "GET",
      url: `/authoring/materials?topicId=${topicId}&format=guide&search=search%20corpus`,
      headers: managerHeaders,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ totalItems: 5 });
    for (const query of ["topicId=not-a-uuid", "format=audio"]) {
      const response = await server.inject({
        method: "GET",
        url: `/authoring/materials?${query}`,
        headers: managerHeaders,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "invalid_request_shape" });
    }
    const collections = await server.inject({
      method: "GET",
      url: "/authoring/collections?kind=topic",
      headers: managerHeaders,
    });
    expect(collections.statusCode).toBe(200);
    expect(collections.json()).toContainEqual(
      expect.objectContaining({
        id: topicId,
        materialCount: 5,
        publishedMaterialCount: 0,
      }),
    );
  });

  test("the Payments group finds a payment by order number, bank payment number or exact amount, without the buyer", async () => {
    const owner = randomUUID();
    await database.prisma.account.create({
      data: {
        id: owner,
        logtoIssuer: "https://identity.invalid",
        logtoSubject: owner,
      },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    const commerce = createProductCommerceFixture(database, owner);
    // 37 % off 2 000 ₽ is 1 260 ₽, an amount no other payment here has.
    const s = await commerce.scenario({ discount: 37 });
    const purchase = commerceValue(
      await s.payments.purchase(s.buyer, s.command),
    );
    const row = await database.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: purchase.purchaseRef },
    });
    const paymentId = row.paymentId ?? "";
    expect(paymentId).toMatch(/^\d+$/u);
    const payments = new BillingPaymentSearch({
      prisma: database.prisma,
      accounts: s.accounts,
    });
    const hit = {
      purchaseRef: purchase.purchaseRef,
      productName: "Курс",
      amountKopecks: 126000,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
    };
    for (const query of [
      purchase.purchaseRef,
      purchase.purchaseRef.toUpperCase(),
      paymentId,
      "1260",
      "1 260 ₽",
      "1\u00a0260\u00a0₽",
      "1260 руб",
      "1260 руб.",
      "1 260,00 ₽",
    ])
      expect(
        await payments.search({ actor: owner, query, limit: 5 }),
        query,
      ).toEqual({ ok: true, value: [hit] });
    for (const query of [
      "126",
      "1260,5",
      "Курс",
      randomUUID(),
      "order@example.test",
    ])
      expect(
        await payments.search({ actor: owner, query, limit: 5 }),
        query,
      ).toEqual({ ok: true, value: [] });

    // A malformed request is invalid, not a refusal of the actor.
    for (const request of [
      { actor: owner, query: " ", limit: 5 },
      { actor: owner, query: "1260", limit: 0 },
      { actor: "not-an-account", query: "1260", limit: 5 },
    ])
      expect(await payments.search(request)).toEqual({
        ok: false,
        error: { code: "invalid_request" },
      });

    for (const permission of ["materials:manage", null] as const) {
      const actor = randomUUID();
      await database.prisma.account.create({
        data: {
          id: actor,
          logtoIssuer: "https://identity.invalid",
          logtoSubject: actor,
        },
      });
      if (permission !== null)
        await database.prisma.accountPermission.create({
          data: { accountId: actor, permission },
        });
      expect(
        await payments.search({
          actor,
          query: purchase.purchaseRef,
          limit: 5,
        }),
      ).toEqual({ ok: false, error: { code: "forbidden" } });
    }

    const materialsOnly = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey,
    });
    await createAccount(manager, "materials:manage");
    const registry = assembleAuthoringSearch([
      ...searchGroups(database.prisma, (actor) => actor === manager),
      assemblePaymentsSearchGroup(
        new BillingPaymentSearch({
          prisma: database.prisma,
          accounts: materialsOnly,
        }),
        peopleDirectory(database.prisma, materialsOnly),
      ),
    ]);
    // The manager has no billing:manage: the Payments group is omitted, not answered empty.
    expect(await registry.search(manager, purchase.purchaseRef)).toEqual({
      ok: true,
      value: {
        groups: [
          { kind: "products", state: "ready", items: [] },
          { kind: "materials", state: "ready", items: [] },
        ],
      },
    });
    const found = await registry.search(owner, purchase.purchaseRef);
    expect(found).toEqual({
      ok: true,
      value: {
        groups: [
          {
            kind: "payments",
            state: "ready",
            items: [hit],
            personSearch: "available",
          },
        ],
      },
    });
    expect(JSON.stringify(found)).not.toContain(s.buyer);
    expect(JSON.stringify(found)).not.toContain("order@example.test");
  });

  test("the Payments group also finds the payments of the people the query names, still without the buyer", async () => {
    const owner = randomUUID();
    await createAccount(owner, "billing:manage");
    const commerce = createProductCommerceFixture(database, owner);
    const person = await commerce.scenario();
    const personPurchase = commerceValue(
      await person.payments.purchase(person.buyer, person.command),
    );
    // A Sign-in Email makes the buyer a person; the other buyer is an unregistered visitor.
    const email = `buyer-${randomUUID()}@example.test`;
    await database.prisma.account.update({
      where: { id: person.buyer },
      data: {
        emailFingerprint: z
          .string()
          .parse(fingerprintEmail(email, emailFingerprintKey)),
      },
    });
    const visitor = await commerce.scenario();
    commerceValue(
      await visitor.payments.purchase(visitor.buyer, visitor.command),
    );
    const row = await database.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: personPurchase.purchaseRef },
    });
    const hit = {
      purchaseRef: personPurchase.purchaseRef,
      productName: "Курс",
      amountKopecks: 200000,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
    };
    const accounts = person.accounts;
    const payments = new BillingPaymentSearch({
      prisma: database.prisma,
      accounts,
    });
    const registry = assembleAuthoringSearch([
      ...searchGroups(database.prisma, (actor) => actor === manager),
      assemblePaymentsSearchGroup(
        payments,
        peopleDirectory(database.prisma, accounts),
      ),
    ]);
    const paymentsOf = async (actor: string, query: string) =>
      await registry.search(actor, query);

    for (const query of [email, email.toUpperCase(), person.buyer]) {
      const found = await paymentsOf(owner, query);
      expect(found, query).toEqual({
        ok: true,
        value: {
          groups: [
            {
              kind: "payments",
              state: "ready",
              items: [hit],
              personSearch: "available",
            },
          ],
        },
      });
      expect(JSON.stringify(found)).not.toContain(person.buyer);
      expect(JSON.stringify(found)).not.toContain(email);
    }
    // A visitor is no person: the people directory does not find them, so neither do payments.
    expect(await paymentsOf(owner, visitor.buyer)).toEqual({
      ok: true,
      value: {
        groups: [
          {
            kind: "payments",
            state: "ready",
            items: [],
            personSearch: "available",
          },
        ],
      },
    });

    // platform:admin holds every right; another role never reads the group, a stranger is refused.
    const admin = randomUUID();
    await createAccount(admin, "platform:admin");
    expect(await paymentsOf(admin, email)).toMatchObject({
      ok: true,
      value: { groups: [{ kind: "payments", items: [hit] }] },
    });
    await createAccount(manager, "materials:manage");
    expect(await paymentsOf(manager, email)).toEqual({
      ok: true,
      value: {
        groups: [
          { kind: "products", state: "ready", items: [] },
          { kind: "materials", state: "ready", items: [] },
        ],
      },
    });
    const stranger = randomUUID();
    await createAccount(stranger, null);
    expect(await paymentsOf(stranger, email)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });

    // The buyer set is bounded and read in one statement, however many buyers it holds.
    const many = Array.from({ length: 20 }, (_, index) =>
      index === 0 ? person.buyer : randomUUID(),
    );
    expect(
      await payments.search({
        actor: owner,
        query: "nobody",
        limit: 5,
        accountIds: [...many, randomUUID()],
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    const observer = createQueryEventClient(database.url);
    try {
      const observed = new BillingPaymentSearch({
        prisma: observer.prisma,
        accounts,
      });
      const one = await observer.measure(() =>
        observed.search({
          actor: owner,
          query: "nobody",
          limit: 5,
          accountIds: [person.buyer],
        }),
      );
      const twenty = await observer.measure(() =>
        observed.search({
          actor: owner,
          query: "nobody",
          limit: 5,
          accountIds: many,
        }),
      );
      expect(one.result).toEqual({ ok: true, value: [hit] });
      expect(twenty.result).toEqual({ ok: true, value: [hit] });
      expect(twenty.statements).toHaveLength(1);
      expect(one.statements).toHaveLength(twenty.statements.length);
    } finally {
      await observer.prisma.$disconnect();
    }
  });

  test("when the people directory fails, the Payments group still answers by order number and amount and says the person was not searched", async () => {
    const owner = randomUUID();
    await createAccount(owner, "billing:manage");
    const commerce = createProductCommerceFixture(database, owner);
    // 41 % off 2 000 ₽ is 1 180 ₽, an amount no other payment here has.
    const s = await commerce.scenario({ discount: 41 });
    const purchase = commerceValue(
      await s.payments.purchase(s.buyer, s.command),
    );
    const row = await database.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: purchase.purchaseRef },
    });
    const hit = {
      purchaseRef: purchase.purchaseRef,
      productName: "Курс",
      amountKopecks: 118000,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
    };
    const payments = new BillingPaymentSearch({
      prisma: database.prisma,
      accounts: s.accounts,
    });
    const unavailablePeople = {
      searchPersonAccounts: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        }),
    };
    const registry = assembleAuthoringSearch([
      assemblePaymentsSearchGroup(payments, unavailablePeople),
    ]);
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      for (const query of [purchase.purchaseRef, "1180", "1 180 ₽"])
        expect(await registry.search(owner, query), query).toEqual({
          ok: true,
          value: {
            groups: [
              {
                kind: "payments",
                state: "ready",
                items: [hit],
                personSearch: "unavailable",
              },
            ],
          },
        });
      // An email cannot be searched now: the empty list says so rather than «no payments».
      const email = `buyer-${randomUUID()}@example.test`;
      expect(await registry.search(owner, email)).toEqual({
        ok: true,
        value: {
          groups: [
            {
              kind: "payments",
              state: "ready",
              items: [],
              personSearch: "unavailable",
            },
          ],
        },
      });
      // Each failure is recorded, with the code only: neither the email nor the order number.
      const records = errors.mock.calls.map(([line]) => String(line));
      const failures = records.filter((line) =>
        line.includes('"dependency_failure"'),
      );
      expect(failures).toHaveLength(4);
      for (const line of failures) {
        expect(JSON.parse(line)).toMatchObject({
          module: "authoring-search",
          operation: "searchAuthoring",
          error: { code: "dependency_unavailable" },
        });
        expect(line).not.toContain(email);
        expect(line).not.toContain(purchase.purchaseRef);
      }
    } finally {
      errors.mockRestore();
    }

    // A refusal by the people directory still omits the group: the actor may not read it.
    const refusing = assembleAuthoringSearch([
      ...searchGroups(database.prisma, (actor) => actor === manager),
      assemblePaymentsSearchGroup(payments, {
        searchPersonAccounts: () =>
          Promise.resolve({
            ok: false as const,
            error: { code: "forbidden" as const },
          }),
      }),
    ]);
    await createAccount(manager, "materials:manage");
    expect(await refusing.search(manager, "1180")).toEqual({
      ok: true,
      value: {
        groups: [
          { kind: "products", state: "ready", items: [] },
          { kind: "materials", state: "ready", items: [] },
        ],
      },
    });
  });

  test("when more people match than the search takes, the Payments group answers the payments of those taken and says the list is cut", async () => {
    const owner = randomUUID();
    await createAccount(owner, "billing:manage");
    const commerce = createProductCommerceFixture(database, owner);
    const s = await commerce.scenario();
    const purchase = commerceValue(
      await s.payments.purchase(s.buyer, s.command),
    );
    const row = await database.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: purchase.purchaseRef },
    });
    const requests: unknown[] = [];
    const registry = assembleAuthoringSearch([
      assemblePaymentsSearchGroup(
        new BillingPaymentSearch({
          prisma: database.prisma,
          accounts: s.accounts,
        }),
        {
          searchPersonAccounts: (_actor, input) => {
            requests.push(input);
            return Promise.resolve({
              ok: true as const,
              value: {
                accountIds: [s.buyer],
                nameSearch: "truncated" as const,
              },
            });
          },
        },
      ),
    ]);
    expect(await registry.search(owner, "Анна")).toEqual({
      ok: true,
      value: {
        groups: [
          {
            kind: "payments",
            state: "ready",
            items: [
              {
                purchaseRef: purchase.purchaseRef,
                productName: "Курс",
                amountKopecks: 200000,
                state: row.state,
                createdAt: row.createdAt.toISOString(),
              },
            ],
            personSearch: "truncated",
          },
        ],
      },
    });
    expect(requests).toEqual([
      { query: "Анна", limit: PAYMENT_SEARCH_ACCOUNT_LIMIT },
    ]);
  });

  /** An Account with one permission, or none; a second call for the same Account changes nothing. */
  async function createAccount(
    id: string,
    permission: "materials:manage" | "billing:manage" | "platform:admin" | null,
  ): Promise<void> {
    await database.prisma.account.upsert({
      where: { id },
      create: { id, logtoIssuer: "https://identity.invalid", logtoSubject: id },
      update: {},
    });
    if (permission !== null)
      await database.prisma.accountPermission.upsert({
        where: { accountId_permission: { accountId: id, permission } },
        create: { accountId: id, permission },
        update: {},
      });
  }

  async function signedIn(
    ...permissions: ("materials:manage" | "billing:manage" | null)[]
  ): Promise<Record<string, string>> {
    const subject = `authoring-search-${randomUUID()}`;
    const bearer = await identity.sign(subject, {
      inside_verified_email: `${subject}@example.test`,
    });
    const headers = { authorization: `Bearer ${bearer}` };
    const created = await server.inject({
      method: "POST",
      url: "/accounts",
      headers,
    });
    expect(created.statusCode).toBe(201);
    const account = await database.prisma.account.findFirstOrThrow({
      where: { logtoSubject: subject },
    });
    for (const permission of permissions)
      if (permission !== null)
        await database.prisma.accountPermission.create({
          data: { accountId: account.id, permission },
        });
    return headers;
  }
});
