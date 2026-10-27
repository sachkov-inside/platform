import { registerFixedClock } from "../support/fixed-clock.js";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  AccountDirectory,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { PeopleDirectory } from "../../src/modules/people-directory/index.js";
import type { PeopleDirectoryDependencies } from "../../src/modules/people-directory/shared/people-composition.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { ReadingActivity } from "../../src/modules/reading-activity/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { HttpTelegramContactsProvider } from "../../src/modules/telegram-membership/infrastructure/http/http-telegram-contacts-provider.js";
import { startTelegramContactsDouble } from "../support/telegram-contacts-double.js";
import { createQueryRowClient } from "./setup/query-rows.js";
import { startPeopleApi, type PeopleApi } from "./setup/people-api.js";
import { refusedRead, unreadPeopleOwners } from "./setup/people-owners.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

/** A Sign-in Email fingerprint of the stored shape for an Account no test searches by address. */
function signInFingerprint(seed: string): string {
  return `v1:${createHash("sha256").update(seed).digest("hex")}`;
}

const productA = "98000000-0000-4000-8000-00000000000a";
const productB = "98000000-0000-4000-8000-00000000000b";
const archivedProduct = "98000000-0000-4000-8000-00000000000c";

/** Every personal fact the fixtures carry: none of them may reach a refused answer. */
const personalFacts = [
  "shared.person@example.test",
  "stale.person@example.test",
  "Анна Телеграмова",
  "anna_tg",
];

/**
 * The owner's people list (#1721) over HTTP: who is a person, exact email and Account ID search,
 * name search through Telegram, product, origin and state filters, the total and a cursor that
 * keeps them, and refusal of every other role without personal data.
 */
describe("People list", () => {
  let api: PeopleApi;
  let owner: Record<string, string>;
  const people = {
    telegram: "",
    billing: "",
    billingTwin: "",
    stale: "",
    signIn: "",
    microNewer: "98000000-0000-4000-8000-000000000101",
    microOlder: "98000000-0000-4000-8000-000000000102",
    visitor: "",
    unverified: "",
  };

  beforeAll(async () => {
    api = await startPeopleApi();
    owner = (await api.signedIn("billing:manage")).headers;
    const ownerId = (await api.signedIn("billing:manage")).accountId;
    await api.database.prisma.product.createMany({
      data: [
        { id: productA, name: "Альфа", slug: "people-alpha" },
        { id: productB, name: "Бета", slug: "people-beta" },
        {
          id: archivedProduct,
          name: "Архивный",
          slug: "people-archived",
          archivedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ],
    });
    // Visitors registered last: newest, yet never listed.
    people.unverified = await api.person({
      registeredAt: "2026-09-12T00:00:00.000Z",
      unverifiedContact: true,
    });
    people.visitor = await api.person({
      registeredAt: "2026-09-11T00:00:00.000Z",
    });
    people.telegram = await api.person({
      registeredAt: "2026-09-10T00:00:00.000Z",
      telegram: {
        displayName: "Анна Телеграмова",
        username: "anna_tg",
        marketing: "enabled",
      },
    });
    people.billing = await api.person({
      registeredAt: "2026-09-09T00:00:00.000Z",
      billingEmail: "shared.person@example.test",
    });
    people.billingTwin = await api.person({
      registeredAt: "2026-09-08T00:00:00.000Z",
      billingEmail: "Shared.Person@example.test",
    });
    // Confirmed again by a release without fingerprints: the old fingerprint belongs to revision 1.
    people.stale = await api.person({
      registeredAt: "2026-09-07T00:00:00.000Z",
      billingEmail: "stale.person@example.test",
      billingRevision: 2,
      fingerprintRevision: 1,
    });
    people.signIn = await api.person({
      registeredAt: "2026-09-06T00:00:00.000Z",
      signInEmail: "learner.sign-in@example.test",
    });
    // Two registrations within one millisecond: the order and the cursor keep microseconds.
    await api.database.prisma.$executeRaw`
      INSERT INTO accounts.accounts(id, logto_issuer, logto_subject, email_fingerprint, created_at)
      VALUES
        (${people.microNewer}::uuid, 'https://identity.people-api.test/oidc', 'micro-newer', ${signInFingerprint("micro-newer")}, '2026-09-05T00:00:00.000200Z'),
        (${people.microOlder}::uuid, 'https://identity.people-api.test/oidc', 'micro-older', ${signInFingerprint("micro-older")}, '2026-09-05T00:00:00.000100Z')`;

    const ok = (result: { ok: boolean }) => {
      if (!result.ok) throw new Error(JSON.stringify(result));
    };
    ok(
      await api.grants.issueProductAccess(
        { source: "purchase" },
        {
          accountId: people.telegram,
          productId: productB,
          sourceRef: "payment:telegram",
          issuedAt: "2026-09-10T01:00:00.000Z",
          reason: "payment_confirmed",
        },
      ),
    );
    for (const productId of [productB, productA])
      ok(
        await api.grants.issueManualProductAccess(ownerId, {
          accountId: people.billing,
          productId,
          sourceRef: `manual:${productId}`,
          reason: "Подарок",
        }),
      );
    ok(
      await api.grants.issueProductAccess(
        { source: "purchase" },
        {
          accountId: people.signIn,
          productId: productA,
          sourceRef: "payment:sign-in",
          issuedAt: "2026-09-06T01:00:00.000Z",
          reason: "payment_confirmed",
        },
      ),
    );
    await revoke(ownerId, people.billing, productB);
    await revoke(ownerId, people.signIn, productA);
    await api.database.prisma.readingMaterialVisit.create({
      data: {
        accountId: people.billing,
        materialId: randomUUID(),
        firstOpenedAt: new Date("2026-09-09T10:00:00.000Z"),
        lastOpenedAt: new Date("2026-09-09T12:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await api.close();
  });

  async function revoke(actor: string, accountId: string, productId: string) {
    const current = await api.grants.readProductAccess(actor, {
      accountId,
      productId,
    });
    if (!current.ok) throw new Error(current.error.code);
    const revoked = await api.grants.revokeProductAccess(actor, {
      accountId,
      productId,
      operationId: randomUUID(),
      expectedRevision: current.value.revision,
      reason: "Возврат оплаты",
    });
    if (!revoked.ok) throw new Error(revoked.error.code);
  }

  async function list(query: Record<string, string> = {}) {
    const response = await api.server.inject({
      method: "GET",
      url: `/authoring/people?${new URLSearchParams(query).toString()}`,
      headers: owner,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const page: {
      items: { accountId: string }[];
      total: number;
      nextCursor: string | null;
      nameSearch: string;
    } = response.json();
    return page;
  }

  const ids = (page: { items: { accountId: string }[] }) =>
    page.items.map((item) => item.accountId);

  test("people are listed newest first with their names, address, Products and last activity; a visitor or an unverified contact never", async () => {
    const page = await list();
    expect(page).toMatchObject({
      total: 7,
      nextCursor: null,
      nameSearch: "available",
    });
    expect(ids(page)).toEqual([
      people.telegram,
      people.billing,
      people.billingTwin,
      people.stale,
      people.signIn,
      people.microNewer,
      people.microOlder,
    ]);
    expect(page.items.slice(0, 2)).toEqual([
      {
        accountId: people.telegram,
        displayName: "Анна Телеграмова",
        username: "anna_tg",
        email: null,
        contactsState: "complete",
        telegram: "linked",
        registeredAt: "2026-09-10T00:00:00.000Z",
        lastActivityAt: null,
        products: [
          {
            productId: productB,
            name: "Бета",
            access: "active",
            origin: "paid",
          },
        ],
      },
      {
        accountId: people.billing,
        displayName: null,
        username: null,
        email: "shared.person@example.test",
        contactsState: "complete",
        telegram: "not_linked",
        registeredAt: "2026-09-09T00:00:00.000Z",
        lastActivityAt: "2026-09-09T12:00:00.000Z",
        // Sorted by name, whatever the order of acquisition.
        products: [
          {
            productId: productA,
            name: "Альфа",
            access: "active",
            origin: "manual",
          },
          {
            productId: productB,
            name: "Бета",
            access: "revoked",
            origin: "manual",
          },
        ],
      },
    ]);
  });

  test("the cursor walks every person once with the same total, microseconds included", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list({
        limit: "2",
        ...(cursor === null ? {} : { cursor }),
      });
      expect(page.total).toBe(7);
      seen.push(...ids(page));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(ids(await list()));
  });

  test("a cursor of other filters, or one the list never issued, is refused", async () => {
    const first = await list({ limit: "1" });
    expect(first.nextCursor).not.toBeNull();
    for (const query of [
      { productId: productA, cursor: first.nextCursor ?? "" },
      { query: "shared.person@example.test", cursor: first.nextCursor ?? "" },
      { cursor: "not-a-cursor" },
      {
        cursor: Buffer.from(
          JSON.stringify({ registeredAt: "x", accountId: "y", scope: "z" }),
        ).toString("base64url"),
      },
    ]) {
      const response = await api.server.inject({
        method: "GET",
        url: `/authoring/people?${new URLSearchParams(query).toString()}`,
        headers: owner,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  test("product, origin and state filters apply together, to any Product without productId", async () => {
    const cases: [Record<string, string>, string[]][] = [
      [{ productId: productA }, [people.billing, people.signIn]],
      [{ productId: productA, state: "revoked" }, [people.signIn]],
      [{ origin: "paid" }, [people.telegram, people.signIn]],
      [{ origin: "manual", state: "revoked" }, [people.billing]],
      [{ state: "active" }, [people.telegram, people.billing]],
      [{ productId: productB, origin: "course_activation" }, []],
    ];
    for (const [query, expected] of cases) {
      const page = await list(query);
      expect(ids(page)).toEqual(expected);
      expect(page.total).toBe(expected.length);
    }
  });

  test("an exact address finds the sign-in and every verified Billing Contact with it, never a stale fingerprint or a part", async () => {
    expect(ids(await list({ query: "  SHARED.person@example.TEST " }))).toEqual(
      [people.billing, people.billingTwin],
    );
    expect(ids(await list({ query: "learner.sign-in@example.test" }))).toEqual([
      people.signIn,
    ]);
    expect(await list({ query: "stale.person@example.test" })).toMatchObject({
      items: [],
      total: 0,
    });
    // A part of an address is name text for Telegram, which knows no such name.
    expect(await list({ query: "shared.person@exam" })).toMatchObject({
      items: [],
      total: 0,
      nameSearch: "available",
    });
    expect(
      ids(
        await list({
          query: "shared.person@example.test",
          productId: productA,
        }),
      ),
    ).toEqual([people.billing]);
  });

  test("an Account ID finds a person and never a visitor", async () => {
    expect(ids(await list({ query: people.stale.toUpperCase() }))).toEqual([
      people.stale,
    ]);
    for (const id of [people.visitor, people.unverified, randomUUID()])
      expect(await list({ query: id })).toMatchObject({ items: [], total: 0 });
  });

  test("a name or @username is searched by Telegram; an older or silent Telegram makes name search unavailable, not empty", async () => {
    for (const query of ["анна", "@ANNA_tg"])
      expect(await list({ query })).toMatchObject({
        items: [{ accountId: people.telegram }],
        total: 1,
        nameSearch: "available",
      });
    expect(await list({ query: "Анна", productId: productA })).toMatchObject({
      items: [],
      total: 0,
      nameSearch: "available",
    });
    for (const mode of ["v1_only", "down"] as const) {
      api.telegram.mode = mode;
      try {
        expect(await list({ query: "Анна" })).toEqual({
          items: [],
          total: 0,
          nextCursor: null,
          nameSearch: "unavailable",
        });
        // ID and email search do not depend on Telegram's search.
        expect(ids(await list({ query: people.billing }))).toEqual([
          people.billing,
        ]);
      } finally {
        api.telegram.mode = "v2";
      }
    }
  });

  test("names stay unknown, not absent, when Telegram cannot read them", async () => {
    api.telegram.mode = "down";
    try {
      const page = await list({ query: people.telegram });
      expect(page.items).toEqual([
        expect.objectContaining({
          accountId: people.telegram,
          displayName: null,
          username: null,
          contactsState: "partial",
          telegram: "linked",
        }),
      ]);
    } finally {
      api.telegram.mode = "v2";
    }
  });

  test("other roles are refused without a personal fact, before their input is read; malformed input is rejected", async () => {
    const urls = [
      "/authoring/people",
      `/authoring/people?query=${encodeURIComponent("shared.person@example.test")}`,
      `/authoring/people?productId=${productA}&state=active`,
      "/authoring/people?limit=0",
      `/authoring/people/${people.billing}`,
      "/authoring/people/not-an-id",
    ];
    for (const permission of [
      "materials:manage",
      "communications:manage",
      null,
    ] as const) {
      const { headers } = await api.signedIn(permission);
      for (const url of urls) {
        const refused = await api.server.inject({
          method: "GET",
          url,
          headers,
        });
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toMatchObject({ code: "forbidden" });
        for (const fact of personalFacts)
          expect(refused.body).not.toContain(fact);
      }
    }
    for (const url of urls)
      expect((await api.server.inject({ method: "GET", url })).statusCode).toBe(
        401,
      );
    for (const query of [
      "query=%20",
      `query=${"a".repeat(161)}`,
      "limit=51",
      "limit=0",
      "productId=not-a-product",
      "origin=gift",
      "state=expired",
    ]) {
      const rejected = await api.server.inject({
        method: "GET",
        url: `/authoring/people?${query}`,
        headers: owner,
      });
      expect(rejected.statusCode, query).toBe(400);
      expect(rejected.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  test("product choices list every Product by name, archived ones flagged, under billing:manage only", async () => {
    const response = await api.server.inject({
      method: "GET",
      url: "/authoring/people/product-choices",
      headers: owner,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({
      items: [
        { productId: productA, name: "Альфа", archived: false },
        { productId: archivedProduct, name: "Архивный", archived: true },
        { productId: productB, name: "Бета", archived: false },
      ],
    });
    for (const permission of [
      "materials:manage",
      "communications:manage",
      null,
    ] as const) {
      const refused = await api.server.inject({
        method: "GET",
        url: "/authoring/people/product-choices",
        headers: (await api.signedIn(permission)).headers,
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ code: "forbidden" });
      expect(refused.body).not.toContain("Альфа");
    }
    expect(
      (
        await api.server.inject({
          method: "GET",
          url: "/authoring/people/product-choices",
        })
      ).statusCode,
    ).toBe(401);
  });

  test("platform:admin holds every permission and lists people", async () => {
    const { headers } = await api.signedIn("platform:admin");
    const response = await api.server.inject({
      method: "GET",
      url: "/authoring/people?limit=1",
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 7 });
  });

  describe("SQL statements of one page", () => {
    let database: TestDatabase;
    let measured: ReturnType<typeof createQueryRowClient>;
    let telegram: Awaited<ReturnType<typeof startTelegramContactsDouble>>;
    const actor = randomUUID();
    const product = randomUUID();
    const measuredKey = randomBytes(32).toString("base64");

    beforeAll(async () => {
      database = await createMigratedTestDatabase();
      measured = createQueryRowClient(database.url);
      telegram = await startTelegramContactsDouble("measure-secret");
      await database.prisma.account.create({
        data: {
          id: actor,
          logtoIssuer: "https://measure.test",
          logtoSubject: actor,
        },
      });
      await database.prisma.accountPermission.create({
        data: { accountId: actor, permission: "billing:manage" },
      });
      await database.prisma.product.create({
        data: { id: product, name: "Measured", slug: "measured" },
      });
      const protection = billingContactProtection(measuredKey);
      const grants = assembleAccessGrants({
        prisma: database.prisma,
        accounts: assembleAccounts({
          prisma: database.prisma,
          emailFingerprintKey: "measure-email-fingerprint-key-000001",
        }),
        contentCatalog: new CoverageCatalog(
          database.prisma,
          new ProductDiscovery(database.prisma),
        ),
      });
      // 30 people: a third by Sign-in Email, a third by Billing Contact, a third by Telegram.
      for (let index = 0; index < 30; index++) {
        const id = randomUUID();
        await database.prisma.account.create({
          data: {
            id,
            logtoIssuer: "https://measure.test",
            logtoSubject: `person-${id}`,
            emailFingerprint: index % 3 === 0 ? signInFingerprint(id) : null,
            createdAt: new Date(Date.UTC(2030, 0, 1, 0, index)),
          },
        });
        if (index % 3 === 1)
          await database.prisma.billingContact.create({
            data: {
              accountId: id,
              revision: 1,
              emailCiphertext: protection.seal(
                id,
                `measure-${String(index)}@example.test`,
              ),
              verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
            },
          });
        if (index % 3 === 2) {
          await database.prisma.telegramAccountLinkState.create({
            data: {
              accountId: id,
              linkRef: randomUUID(),
              revision: 1,
              principalRef: `principal:${id}`,
              identityRef: `identity:${id}`,
              updatedAt: new Date("2026-09-01T00:00:00.000Z"),
            },
          });
          telegram.profiles.set(`identity:${id}`, {
            accountRef: `principal:${id}`,
            telegramIdentityRef: `identity:${id}`,
            displayName: `Measured ${String(index)}`,
            username: null,
            marketing: "unknown",
          });
        }
        const issued = await grants.issueManualProductAccess(actor, {
          accountId: id,
          productId: product,
          sourceRef: `manual:${id}`,
          reason: "Measured",
        });
        if (!issued.ok) throw new Error(issued.error.code);
      }
    });

    afterAll(async () => {
      await measured.prisma.$disconnect();
      await telegram.close();
      await database.dispose();
    });

    test.each([
      { label: "every person", input: { limit: 25 } },
      { label: "one Product", input: { limit: 25, productId: product } },
    ])("a 25-row page of $label", async ({ label, input }) => {
      const prisma = measured.prisma;
      const accounts = assembleAccounts({
        prisma,
        emailFingerprintKey: "measure-email-fingerprint-key-000001",
      });
      const learning = new ReadingActivity({
        prisma,
        contentAccess: {
          authorize: refusedRead,
          checkProductAccess: refusedRead,
        },
        materialContent: { findAccessFacts: refusedRead },
        composition: { read: refusedRead },
      });
      const dependencies: PeopleDirectoryDependencies = {
        accounts,
        directory: new AccountDirectory({
          prisma,
          protection: billingContactProtection(measuredKey),
          emailFingerprintKey: "measure-email-fingerprint-key-000001",
        }),
        telegram: new TelegramAccountLinks(
          prisma,
          new HttpTelegramContactsProvider(
            telegram.linkingEndpoint,
            "measure-secret",
          ),
        ),
        access: assembleAccessGrants({ prisma, accounts }),
        products: new ProductDiscovery(prisma),
        learning,
        payments: unreadPeopleOwners.payments,
        submissions: unreadPeopleOwners.submissions,
        community: unreadPeopleOwners.community,
        waitlists: unreadPeopleOwners.waitlists,
      };
      const directory = new PeopleDirectory(dependencies);
      const providerRequests = telegram.requests.length;
      const reading = await measured.measure(() =>
        directory.listPeople(actor, input),
      );
      expect(reading.result).toMatchObject({ ok: true });
      if (!reading.result.ok) return;
      expect(reading.result.value.items).toHaveLength(25);
      expect(reading.result.value.total).toBe(30);
      const statements = reading.statements.filter(
        (sql) => !/^\s*(BEGIN|COMMIT|SET|ROLLBACK)/iu.test(sql),
      );
      process.stdout.write(
        `${JSON.stringify({
          record: "people-list-page",
          page: label,
          rows: reading.result.value.items.length,
          sqlStatements: statements.length,
          sqlEvents: reading.statements.length,
          returnedRows: reading.rows.reduce((sum, row) => sum + row.count, 0),
          returnedBytes: reading.rows.reduce(
            (sum, row) => sum + row.serializedBytes,
            0,
          ),
          providerRequests: telegram.requests.length - providerRequests,
          elapsedMs: Math.round(reading.elapsedMs),
        })}\n`,
      );
      expect(telegram.requests.length - providerRequests).toBe(1);
      // Fixed per page, whatever its size: the actor's right (2), current links (1), the page
      // with its total (1), last activity (1), access summaries with their right check (3),
      // the page's Telegram bindings read twice around the provider call (2) and Product names
      // (1); a filter adds the access set with its right check (3).
      expect(statements).toHaveLength("productId" in input ? 14 : 11);
    });
  });
});
