import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import {
  peopleFingerprintKey,
  startPeopleApi,
  type PeopleApi,
} from "./setup/people-api.js";

registerFixedClock();

const productA = "99000000-0000-4000-8000-00000000000a";
const productB = "99000000-0000-4000-8000-00000000000b";
const linkId = "99000000-0000-4000-8000-0000000000c1";

const snapshot = (withProduct: boolean, withLink: boolean) => ({
  ...(withProduct
    ? { product: { id: productA, name: "Альфа в оплате", priceRevision: 1 } }
    : {}),
  ...(withLink
    ? { individualPayment: { linkId, basePriceKopecks: 150000 } }
    : {}),
  offer: {
    id: "99000000-0000-4000-8000-0000000000d1",
    revision: 1,
    name: "Предложение",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: "99000000-0000-4000-8000-0000000000d2",
    revision: 1,
    offerId: "99000000-0000-4000-8000-0000000000d1",
    months: 1,
    priceKopecks: 150000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 150000,
  renewalPriceKopecks: 150000,
});

/**
 * The person card (#1721) over HTTP: header, Products with their history, actors and reasons,
 * payments, learning, submissions behind `materials:manage`, Telegram facts that stay unknown
 * rather than absent, waitlists, a block that fails on its own, and 404 for a visitor.
 */
describe("Person card", () => {
  let api: PeopleApi;
  let owner: Record<string, string>;
  let author: Record<string, string>;
  let ownerPerson = "";
  let person = "";
  let unknownTelegram = "";
  let visitor = "";
  let restorer = "";
  const intake = randomUUID();

  beforeAll(async () => {
    api = await startPeopleApi();
    owner = (await api.signedIn("billing:manage")).headers;
    const both = await api.signedIn("billing:manage");
    await api.database.prisma.accountPermission.create({
      data: { accountId: both.accountId, permission: "materials:manage" },
    });
    author = both.headers;
    restorer = (await api.signedIn("billing:manage")).accountId;
    // An actor who is a person too: the history names them by their address.
    ownerPerson = await api.person({
      billingEmail: "owner.person@example.test",
    });
    await api.database.prisma.accountPermission.create({
      data: { accountId: ownerPerson, permission: "billing:manage" },
    });
    person = await api.person({
      registeredAt: "2026-09-01T00:00:00.000Z",
      billingEmail: "card.person@example.test",
      telegram: {
        displayName: "Карточка Человекова",
        username: "card_person",
        marketing: "stopped",
      },
    });
    unknownTelegram = await api.person({
      registeredAt: "2026-09-02T00:00:00.000Z",
      telegram: "unknown",
    });
    visitor = await api.person({ unverifiedContact: true });
    await api.database.prisma.product.createMany({
      data: [
        { id: productA, name: "Альфа", slug: "card-alpha" },
        { id: productB, name: "Бета", slug: "card-beta" },
      ],
    });

    // Each event at its own instant, so the history order is the order of events.
    let now = new Date("2026-09-10T10:00:00.000Z");
    const grants = assembleAccessGrants({
      prisma: api.database.prisma,
      accounts: assembleAccounts({
        prisma: api.database.prisma,
        emailFingerprintKey: peopleFingerprintKey,
      }),
      contentCatalog: new CoverageCatalog(
        api.database.prisma,
        new ProductDiscovery(api.database.prisma),
      ),
      clock: () => now,
    });
    const ok = (result: { ok: boolean }) => {
      if (!result.ok) throw new Error(JSON.stringify(result));
    };
    ok(
      await grants.issueProductAccess(
        { source: "purchase" },
        {
          accountId: person,
          productId: productA,
          sourceRef: "payment:card",
          issuedAt: "2026-09-10T09:00:00.000Z",
          reason: "payment_confirmed",
        },
      ),
    );
    now = new Date("2026-09-11T10:00:00.000Z");
    ok(
      await grants.issueManualProductAccess(ownerPerson, {
        accountId: person,
        productId: productB,
        sourceRef: "manual:card",
        reason: "Подарок",
      }),
    );
    const change = async (
      kind: "revoke" | "restore",
      actor: string,
      reason: string,
    ) => {
      const current = await grants.readProductAccess(actor, {
        accountId: person,
        productId: productA,
      });
      if (!current.ok) throw new Error(current.error.code);
      const command = {
        accountId: person,
        productId: productA,
        operationId: randomUUID(),
        expectedRevision: current.value.revision,
        reason,
      };
      ok(
        kind === "revoke"
          ? await grants.revokeProductAccess(actor, command)
          : await grants.restoreProductAccess(actor, command),
      );
    };
    now = new Date("2026-09-12T10:00:00.000Z");
    await change("revoke", ownerPerson, "Возврат оплаты");
    now = new Date("2026-09-13T10:00:00.000Z");
    await change("restore", restorer, "Выдано по ошибке");

    // 21 payments: the card shows the newest 20; only the newest went through a Payment Link.
    const purchase = (prefix: string, index: number) =>
      `99000000-0000-4000-8000-000000000${prefix}${String(index).padStart(2, "0")}`;
    await api.database.prisma.billingPriceQuote.createMany({
      data: Array.from({ length: 21 }, (_, index) => ({
        id: purchase("3", index),
        accountId: person,
        operationId: purchase("4", index),
        fingerprint: `person-card-${String(index)}`,
        snapshot: snapshot(index % 2 === 0, index === 20),
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
        expiresAt: new Date(Date.UTC(2026, 8, 2)),
      })),
    });
    await api.database.prisma.billingPurchase.createMany({
      data: Array.from({ length: 21 }, (_, index) => ({
        id: purchase("2", index),
        quoteRef: purchase("3", index),
        accountId: person,
        state: index === 20 ? "confirmed" : "failed",
        kind: index === 20 ? "one_time" : "initial",
        confirmedAt: index === 20 ? new Date(Date.UTC(2026, 8, 1, 1)) : null,
        lifecycleActive: false,
        environment: "demo",
        terminalRef: "PERSONCARD",
        amountKopecks: 150000n,
        snapshot: snapshot(index % 2 === 0, index === 20),
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
        updatedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
      })),
    });
    await api.database.prisma.productLearningStarted.create({
      data: {
        accountId: person,
        productId: productA,
        startedAt: new Date("2026-09-10T11:00:00.000Z"),
      },
    });
    await api.database.prisma.productWaitlistIntake.create({
      data: { id: intake, productId: productB, name: "Осенний поток" },
    });
    await api.database.prisma.productWaitlistMembership.create({
      data: {
        intakeId: intake,
        accountId: person,
        active: true,
        joinedAt: new Date("2026-09-05T00:00:00.000Z"),
        updatedAt: new Date("2026-09-05T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await api.close();
  });

  async function card(accountId: string, headers = owner) {
    const response = await api.server.inject({
      method: "GET",
      url: `/authoring/people/${accountId}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const body: Record<string, unknown> = response.json();
    return body;
  }

  test("the card names the person and every block answers: Products with history, actors and reasons newest first", async () => {
    const answer = await card(person.toUpperCase());
    expect(answer["person"]).toEqual({
      accountId: person,
      displayName: "Карточка Человекова",
      username: "card_person",
      email: "card.person@example.test",
      contactsState: "complete",
      registeredAt: "2026-09-01T00:00:00.000Z",
      telegramUrl: "https://t.me/card_person",
    });
    expect(answer["products"]).toEqual({
      state: "ready",
      items: [
        {
          productId: productA,
          name: "Альфа",
          access: "active",
          revision: 3,
          firstIssuedAt: "2026-09-10T09:00:00.000Z",
          origin: "paid",
          history: [
            {
              kind: "restore",
              at: "2026-09-13T10:00:00.000Z",
              actor: { kind: "person", accountId: restorer, label: null },
              reason: "Выдано по ошибке",
            },
            {
              kind: "revoke",
              at: "2026-09-12T10:00:00.000Z",
              actor: {
                kind: "person",
                accountId: ownerPerson,
                label: "owner.person@example.test",
              },
              reason: "Возврат оплаты",
            },
            {
              kind: "purchase",
              at: "2026-09-10T09:00:00.000Z",
              actor: { kind: "system" },
              reason: "payment_confirmed",
            },
          ],
        },
        {
          productId: productB,
          name: "Бета",
          access: "active",
          revision: 1,
          firstIssuedAt: "2026-09-11T10:00:00.000Z",
          origin: "manual",
          history: [
            {
              kind: "manual_issue",
              at: "2026-09-11T10:00:00.000Z",
              actor: {
                kind: "person",
                accountId: ownerPerson,
                label: "owner.person@example.test",
              },
              reason: "Подарок",
            },
          ],
        },
      ],
    });
    expect(answer["telegram"]).toEqual({
      state: "ready",
      link: "linked",
      // Platform has no community observation yet: unknown, never «not a member».
      membership: "unknown",
      restriction: "unknown",
      marketing: "stopped",
      observedAt: null,
    });
    expect(answer["waitlists"]).toEqual({
      state: "ready",
      items: [
        {
          productId: productB,
          productName: "Бета",
          intakeName: "Осенний поток",
          active: true,
          joinedAt: "2026-09-05T00:00:00.000Z",
        },
      ],
    });
    expect(answer["learning"]).toMatchObject({
      state: "ready",
      items: [
        {
          productId: productA,
          name: "Альфа",
          startedAt: "2026-09-10T11:00:00.000Z",
        },
        { productId: productB, name: "Бета", startedAt: null },
      ],
    });
  });

  test("payments are the newest 20 with Billing's state, the snapshot Product and only the Payment Link paid through", async () => {
    const payments = (await card(person))["payments"];
    expect(payments).toMatchObject({ state: "ready" });
    const { items } = z
      .object({ items: z.array(z.record(z.string(), z.unknown())) })
      .parse(payments);
    expect(items).toHaveLength(20);
    expect(items[0]).toEqual({
      paymentId: "99000000-0000-4000-8000-000000000220",
      productId: productA,
      productName: "Альфа в оплате",
      amountKopecks: 150000,
      state: "confirmed",
      createdAt: "2026-09-01T00:20:00.000Z",
      paymentLinkId: linkId,
    });
    expect(items[1]).toEqual({
      paymentId: "99000000-0000-4000-8000-000000000219",
      productId: null,
      productName: null,
      amountKopecks: 150000,
      state: "failed",
      createdAt: "2026-09-01T00:19:00.000Z",
      paymentLinkId: null,
    });
    expect(items.at(-1)).toMatchObject({
      paymentId: "99000000-0000-4000-8000-000000000201",
    });
    // No Order Email or other contact reaches the card.
    expect(JSON.stringify(payments)).not.toContain("@");
  });

  test("submissions need materials:manage as well; with it they answer and never carry an email", async () => {
    expect((await card(person))["submissions"]).toEqual({
      state: "forbidden",
    });
    const submissions = (await card(person, author))["submissions"];
    expect(submissions).toEqual({ state: "ready", items: [] });
  });

  test("an unknown Telegram contact stays unknown, and an older Telegram leaves the /stop state unknown", async () => {
    const unknown = await card(unknownTelegram);
    expect(unknown["person"]).toMatchObject({
      displayName: null,
      username: null,
      contactsState: "partial",
      telegramUrl: null,
    });
    expect(unknown["telegram"]).toMatchObject({
      state: "ready",
      link: "linked",
      membership: "unknown",
      marketing: "unknown",
    });
    api.telegram.mode = "v1_only";
    try {
      const older = await card(person);
      expect(older["person"]).toMatchObject({
        displayName: "Карточка Человекова",
        contactsState: "complete",
      });
      expect(older["telegram"]).toMatchObject({ marketing: "unknown" });
    } finally {
      api.telegram.mode = "v2";
    }
    api.telegram.mode = "down";
    try {
      const silent = await card(person);
      expect(silent["person"]).toMatchObject({
        displayName: null,
        email: "card.person@example.test",
        contactsState: "partial",
      });
      expect(silent["telegram"]).toMatchObject({
        state: "ready",
        link: "linked",
        marketing: "unknown",
      });
    } finally {
      api.telegram.mode = "v2";
    }
  });

  test("a failing owner leaves its block unavailable and every other block ready", async () => {
    await api.database.prisma
      .$executeRaw`ALTER TABLE sales_funnel.product_waitlist_memberships RENAME TO product_waitlist_memberships_away`;
    await api.database.prisma
      .$executeRaw`ALTER TABLE billing.purchases RENAME TO purchases_away`;
    try {
      const answer = await card(person, author);
      expect(answer["waitlists"]).toEqual({ state: "unavailable" });
      expect(answer["payments"]).toEqual({ state: "unavailable" });
      for (const block of ["products", "learning", "submissions", "telegram"])
        expect(answer[block], block).toMatchObject({ state: "ready" });
      expect(answer["person"]).toMatchObject({ accountId: person });
    } finally {
      await api.database.prisma
        .$executeRaw`ALTER TABLE sales_funnel.product_waitlist_memberships_away RENAME TO product_waitlist_memberships`;
      await api.database.prisma
        .$executeRaw`ALTER TABLE billing.purchases_away RENAME TO purchases`;
    }
  });

  test("an Account that is no person, or none at all, is not found; a malformed ID is rejected", async () => {
    for (const id of [visitor, randomUUID()]) {
      const response = await api.server.inject({
        method: "GET",
        url: `/authoring/people/${id}`,
        headers: owner,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "not_found" });
    }
    const malformed = await api.server.inject({
      method: "GET",
      url: "/authoring/people/not-an-id",
      headers: owner,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: "invalid_request" });
  });

  test("other roles are refused without a personal fact", async () => {
    for (const permission of [
      "materials:manage",
      "communications:manage",
      null,
    ] as const) {
      const { headers } = await api.signedIn(permission);
      for (const id of [person, visitor]) {
        const refused = await api.server.inject({
          method: "GET",
          url: `/authoring/people/${id}`,
          headers,
        });
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toMatchObject({ code: "forbidden" });
        for (const fact of [
          "card.person@example.test",
          "Карточка Человекова",
          "card_person",
          "Альфа",
        ])
          expect(refused.body).not.toContain(fact);
      }
    }
    expect(
      (
        await api.server.inject({
          method: "GET",
          url: `/authoring/people/${person}`,
        })
      ).statusCode,
    ).toBe(401);
    const admin = await api.signedIn("platform:admin");
    expect((await card(person, admin.headers))["submissions"]).toMatchObject({
      state: "ready",
    });
  });
});
