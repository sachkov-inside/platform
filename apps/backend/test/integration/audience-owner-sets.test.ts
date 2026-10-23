import { outsideTransaction } from "./setup/transaction-guard.js";
import { composeMaterialAccessFacts } from "../../src/entrypoints/composition/material-access-facts.js";
import { ProductCatalogue } from "../../src/modules/products/index.js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  grantProductFixture,
  revokeProductFixture,
} from "./setup/product-access.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { createQueryEventClient } from "./setup/query-events.js";
import {
  NotificationAccounts,
  assembleAccounts,
  accountId,
} from "../../src/modules/accounts/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";

import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
} from "../../src/modules/content-access/index.js";
import {
  assembleMaterialResourceFacts,
  materialBodyOperations,
  materialId,
} from "../../src/modules/materials/index.js";
import { assembleMaterialContent } from "../../src/modules/materials/facets/material-content/material-content.js";

import {
  Notifications,
  assembleNotificationRecipients,
  type NotificationDependencies,
} from "../../src/modules/notifications/index.js";
import { refreshDeliveries } from "../../src/modules/notifications/features/expand-audience/refresh-deliveries.js";
import { expandAudience } from "../../src/modules/notifications/features/expand-audience/expand-audience.js";
import { encodeNotification } from "../../src/infrastructure/notification-transport/wire.js";
import type { NotificationEvent } from "../../src/modules/notifications/domain/notification-wire.js";
import { MaterialAnnouncements } from "../../src/modules/materials/facets/material-announcements/material-announcements.js";

let database: TestDatabase;
const instant = new Date("2030-01-01T00:00:00Z");
const material = "60000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  await database.prisma.product.create({
    data: { id: material, slug: "rights-owner-sets", name: "Owner sets" },
  });
});
afterAll(async () => {
  await database.dispose();
});

describe.each([1, 25, 100])("resource-aware rights for %i Accounts", (size) => {
  const accounts = Array.from({ length: size }, (_, index) =>
    accountId(
      `5a000000-0000-4000-8000-${String(size * 1000 + index).padStart(12, "0")}`,
    ),
  );
  beforeEach(async () => {
    await database.prisma.account.createMany({
      data: accounts.map((id) => ({
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
        createdAt: instant,
      })),
    });
    await database.prisma.productAccess.createMany({
      data: accounts.map((id) => ({
        accountId: id,
        productId: material,
        firstIssuedAt: instant,
        revision: 1,
      })),
    });
  });
  test("resolves scoped rights in bounded owner reads", async () => {
    const observer = createQueryEventClient(database.url);
    try {
      const rights = assembleAccountRights({
        prisma: observer.prisma,
        clock: () => instant,
      });
      const readSet = rights.resolveForAccessAccounts?.bind(rights);
      if (readSet === undefined)
        throw new Error("Missing many-Account scoped rights capability");
      const baseline = await observer.measure(async () => {
        const results = [];
        for (const id of accounts)
          results.push(await rights.resolveForAccess(id, [material], material));
        return results;
      });
      const after = await observer.measure(() =>
        readSet(accounts, [material], material),
      );
      expect([...after.result.values()]).toEqual(
        accounts.map(() => ({
          kind: "active",
          validUntil: null,
        })),
      );
      expect([...after.result.values()]).toEqual(baseline.result);
      expect(
        baseline.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(size);
      expect(
        after.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(2);
      const unrelated = await readSet(
        accounts,
        [],
        "60000000-0000-4000-8000-000000000002",
      );
      expect([...unrelated.values()]).toEqual(
        accounts.map(() => ({ kind: "required" })),
      );
      const first = accounts[0];
      if (first === undefined) throw new Error("Missing seeded Account");
      const requested = [
        accountId(first.toUpperCase()),
        first,
        accountId(first.toUpperCase()),
      ];
      const aliases = await readSet(requested, [material], material);
      expect([...aliases.keys()]).toEqual([first.toUpperCase(), first]);
      expect([...aliases.values()]).toEqual([
        { kind: "active", validUntil: null },
        { kind: "active", validUntil: null },
      ]);
    } finally {
      await observer.prisma.$disconnect();
    }
  });
});

describe("projects author permission for an Account set without repeated Account and permission reads", () => {
  const ids = Array.from(
    { length: 25 },
    (_, index) =>
      `b2000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );

  beforeEach(async () => {
    await database.prisma.account.createMany({
      data: ids.map((id) => ({
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
        createdAt: instant,
      })),
    });
    await database.prisma.accountPermission.createMany({
      data: [
        {
          accountId: ids[0] ?? "",
          permission: "materials:manage",
          createdAt: instant,
        },
        {
          accountId: ids[1] ?? "",
          permission: "platform:admin",
          createdAt: instant,
        },
      ],
    });
  });
  test("preserves facts with bounded owner SQL", async () => {
    const observer = createQueryEventClient(database.url);
    try {
      const accounts = assembleAccounts({
        prisma: observer.prisma,
        emailFingerprintKey: "synthetic-email-fingerprint-key-123456",
      });
      const readSet = accounts.checkPermissionsMany?.bind(accounts);
      if (readSet === undefined)
        throw new Error("Missing permission set capability");
      const baseline = await observer.measure(async () => {
        const results = [];
        for (const id of ids)
          results.push(
            await accounts.checkPermission({
              accountId: id,
              permission: "materials:manage",
            }),
          );
        return results;
      });
      const after = await observer.measure(() =>
        readSet({ accountIds: ids, permission: "materials:manage" }),
      );
      expect([...after.result.values()]).toEqual([
        { ok: true, allowed: true },
        { ok: true, allowed: true },
        ...ids.slice(2).map(() => ({ ok: true, allowed: false })),
      ]);
      expect([...after.result.values()]).toEqual(baseline.result);
      expect(
        baseline.statements.filter((sql) => sql.startsWith("SELECT")),
      ).toHaveLength(50);
      expect(
        after.statements.filter((sql) => sql.startsWith("SELECT")),
      ).toHaveLength(2);
      const first = ids[0];
      if (first === undefined) throw new Error("Missing seeded Account");
      const aliases = await readSet({
        accountIds: [first.toUpperCase(), first, first.toUpperCase()],
        permission: "materials:manage",
      });
      expect([...aliases.keys()]).toEqual([first.toUpperCase(), first]);
      expect([...aliases.values()]).toEqual([
        { ok: true, allowed: true },
        { ok: true, allowed: true },
      ]);
    } finally {
      await observer.prisma.$disconnect();
    }
  });
});

describe("authorizes 25 Accounts for one Material using shared resource and scoped owner sets", () => {
  const ids = Array.from({ length: 25 }, (_, index) =>
    accountId(`c3000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
  );
  const resource = materialId("94000000-0000-4000-8000-000000000001");

  beforeEach(async () => {
    await database.prisma.account.createMany({
      data: ids.map((id) => ({
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
        createdAt: instant,
      })),
    });
    const topic = "96000000-0000-4000-8000-000000000001";
    await database.prisma.topic.create({
      data: {
        id: topic,
        slug: "owner-set-topic",
        name: "Synthetic",
        createdAt: instant,
        updatedAt: instant,
      },
    });
    await database.prisma.material.create({
      data: {
        id: resource,
        createdBy: ids[0] ?? "",
        schemaVersion: 1,
        body: { type: "doc", content: [] },
        title: "Synthetic lesson",
        topicId: topic,
        formatId: "guide",
        slug: "synthetic-owner-set-lesson",
        access: "closed",
        publicationState: "published",
        firstPublishedAt: instant,
        publishedAt: instant,
        publishedBy: ids[0] ?? "",
        summary: "Synthetic scoped lesson",
        contentVersion: 1n,
        createdAt: instant,
        updatedAt: instant,
      },
    });
    await database.prisma.accountPermission.create({
      data: {
        accountId: ids[0] ?? "",
        permission: "materials:manage",
        createdAt: instant,
      },
    });
    await database.prisma.product.create({
      data: {
        id: resource,
        slug: "material-owner-sets",
        name: "Scoped Product",
      },
    });
    await database.prisma.productMembership.create({
      data: { seriesId: resource, materialId: resource },
    });
    await database.prisma.productAccess.createMany({
      data: ids.slice(1).map((id, index) => ({
        accountId: id,
        productId: index === 23 ? material : resource,
        firstIssuedAt: instant,
        revision: 1,
      })),
    });
  });
  test("preserves facts with bounded owner SQL", async () => {
    const observer = createQueryEventClient(database.url);
    try {
      const accounts = assembleAccounts({
        prisma: observer.prisma,
        emailFingerprintKey: "synthetic-email-fingerprint-key-123456",
      });
      const access = assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(
          composeMaterialAccessFacts(
            assembleMaterialContent({
              prisma: observer.prisma,
              materialBodyOperations,
            }),
            new ProductCatalogue(observer.prisma),
          ),
        ),
        accountPermissions: assembleCurrentAccountPermissions(accounts),
        accountRights: assembleAccountRights({
          prisma: observer.prisma,
          clock: () => instant,
        }),
        clock: () => instant,
      });
      const authorizeSet = access.authorizeAccounts?.bind(access);
      if (authorizeSet === undefined)
        throw new Error("Missing many-Account Content Access boundary");
      const request = {
        resource: { kind: "material" as const, materialId: resource },
        action: "read" as const,
        enforcementPoint: "published_material_read" as const,
        correlationId: "synthetic-audience",
      };
      const baseline = await observer.measure(async () => {
        const result = [];
        for (const id of ids)
          result.push(
            await access.authorize({
              ...request,
              subject: { kind: "account", accountId: id },
            }),
          );
        return result;
      });
      const after = await observer.measure(() =>
        authorizeSet({ ...request, accountIds: ids }),
      );
      const outcomes = (
        decisions: readonly { effect: string; reason: string }[],
      ) => decisions.map(({ effect, reason }) => ({ effect, reason }));
      expect(outcomes([...after.result.values()])).toEqual([
        { effect: "allow", reason: "materials_manager" },
        ...ids
          .slice(1, 24)
          .map(() => ({ effect: "allow", reason: "active_membership" })),
        { effect: "deny", reason: "membership_required" },
      ]);
      expect(outcomes([...after.result.values()])).toEqual(
        outcomes(baseline.result),
      );
      expect(
        after.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(7);
      expect(
        baseline.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(149);
      const first = ids[0];
      if (first === undefined) throw new Error("Missing seeded Account");
      const aliases = await authorizeSet({
        ...request,
        accountIds: [
          accountId(first.toUpperCase()),
          first,
          accountId(first.toUpperCase()),
        ],
      });
      expect([...aliases.keys()]).toEqual([first.toUpperCase(), first]);
      expect(outcomes([...aliases.values()])).toEqual([
        { effect: "allow", reason: "materials_manager" },
        { effect: "allow", reason: "materials_manager" },
      ]);
    } finally {
      await observer.prisma.$disconnect();
    }
  });
});

describe("25-recipient Material expansion owner cost", () => {
  let audienceDatabase: TestDatabase;
  let observer: ReturnType<typeof createQueryEventClient>;
  let app: Notifications;
  let deps: NotificationDependencies;
  let oneAccessCalls: number;
  let manyAccessCalls: number;
  let bindingSetCalls: number;
  const ids = Array.from({ length: 25 }, (_, index) =>
    accountId(`a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
  );
  const resource = materialId("a1000000-0000-4000-8000-000000000001");
  const event: NotificationEvent = {
    contractVersion: "inside.notification-event.v1",
    messageId: "a2000000-0000-4000-8000-000000000001",
    occurrenceRef: "a3000000-0000-4000-8000-000000000001",
    sourceRef: resource,
    sourceRevision: 1,
    occurredAt: "2030-01-01T00:00:00.000Z",
    notAfter: "2030-01-02T00:00:00.000Z",
    eventType: "material.published",
  };
  beforeEach(async () => {
    audienceDatabase = await createMigratedTestDatabase();
    observer = createQueryEventClient(audienceDatabase.url);
    oneAccessCalls = 0;
    manyAccessCalls = 0;
    bindingSetCalls = 0;
    const prisma = audienceDatabase.prisma;
    await prisma.account.createMany({
      data: ids.map((id) => ({
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
        createdAt: new Date("2029-01-01T00:00:00Z"),
      })),
    });
    const topic = "a4000000-0000-4000-8000-000000000001";
    await prisma.topic.create({
      data: {
        id: topic,
        slug: "audience-topic",
        name: "Synthetic",
        createdAt: instant,
        updatedAt: instant,
      },
    });
    await prisma.material.create({
      data: {
        id: resource,
        createdBy: ids[0] ?? "",
        schemaVersion: 1,
        body: { type: "doc", content: [] },
        title: "Synthetic lesson",
        summary: "Synthetic",
        slug: "synthetic-audience-lesson",
        topicId: topic,
        formatId: "guide",
        access: "closed",
        publicationState: "published",
        firstPublishedAt: instant,
        publishedAt: instant,
        publishedBy: ids[0] ?? "",
        contentVersion: 1n,
        createdAt: instant,
        updatedAt: instant,
      },
    });
    await prisma.product.create({
      data: {
        id: resource,
        slug: "notification-owner-sets",
        name: "Notification Product",
      },
    });
    await prisma.productMembership.create({
      data: { seriesId: resource, materialId: resource },
    });
    await prisma.productAccess.createMany({
      data: ids.slice(0, 24).map((id) => ({
        accountId: id,
        productId: resource,
        firstIssuedAt: instant,
        revision: 1,
      })),
    });
    await prisma.billingContact.createMany({
      data: ids.map((id) => ({
        accountId: id,
        revision: 1,
        emailCiphertext: "synthetic_ciphertext",
        verifiedAt: instant,
      })),
    });
    await prisma.telegramAccountLinkState.createMany({
      data: ids.map((id, index) => ({
        accountId: id,
        linkRef: `a6000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        revision: 1,
        principalRef: id,
        identityRef: `identity-${index}`,
        updatedAt: instant,
      })),
    });
    await prisma.notificationPreference.createMany({
      data: ids.map((id, index) => ({
        accountId: id,
        revision: 1,
        email: index !== 0,
        telegram: true,
        changedAt: new Date("2029-12-31T23:59:00Z"),
      })),
    });
    await prisma.notificationPreferenceRevision.createMany({
      data: ids.map((id, index) => ({
        accountId: id,
        revision: 1,
        operationId: `a7000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        fingerprint: "synthetic-preferences",
        email: true,
        telegram: true,
        changedAt: new Date("2029-12-31T23:59:00Z"),
      })),
    });
    await prisma.materialAnnouncement.create({
      data: {
        id: event.occurrenceRef,
        materialId: resource,
        revision: 1,
        occurredAt: instant,
        notAfter: new Date(event.notAfter),
        title: "Synthetic lesson",
        readerPath: "/materials/synthetic-audience-lesson",
        createdAt: instant,
        updatedAt: instant,
      },
    });
    await prisma.materialAnnouncementRevision.create({
      data: {
        announcementRef: event.occurrenceRef,
        revision: 1,
        messageId: event.messageId,
        payload: event,
        createdAt: instant,
      },
    });
    const accounts = assembleAccounts({
      prisma: observer.prisma,
      emailFingerprintKey: "synthetic-email-fingerprint-key-123456",
    });
    const access = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        composeMaterialAccessFacts(
          assembleMaterialContent({
            prisma: observer.prisma,
            materialBodyOperations,
          }),
          new ProductCatalogue(observer.prisma),
        ),
      ),
      accountPermissions: assembleCurrentAccountPermissions(accounts),
      accountRights: assembleAccountRights({
        prisma: observer.prisma,
        clock: () => instant,
      }),
      clock: () => instant,
    });
    const announcements = new MaterialAnnouncements({
      prisma: observer.prisma,
    });
    const contacts = new NotificationAccounts(observer.prisma, undefined);
    const links = new TelegramAccountLinks(observer.prisma);
    const recipients = assembleNotificationRecipients(
      contacts,
      { purchaseEmail: () => Promise.resolve({ ok: true, value: null }) },
      links,
    );
    function outcome(decision: {
      effect: string;
      reason: string;
    }): "allowed" | "denied" | "unavailable" {
      return decision.effect === "allow"
        ? "allowed"
        : decision.reason === "dependency_unavailable"
          ? "unavailable"
          : "denied";
    }
    const request = {
      resource: { kind: "material" as const, materialId: resource },
      action: "read" as const,
      enforcementPoint: "published_material_read" as const,
      correlationId: "notifications",
    };
    deps = {
      prisma: observer.prisma,
      origin: "https://inside.example.test",
      now: () => instant,
      sources: {
        resolve: (input) => announcements.resolveAnnouncement(input),
        canRead: async (id) => {
          oneAccessCalls++;
          return outcome(
            await access.authorize({
              ...request,
              subject: { kind: "account", accountId: accountId(id) },
            }),
          );
        },
        canReadAccounts: async (accounts) => {
          manyAccessCalls++;
          if (access.authorizeAccounts === undefined)
            throw new Error("Missing access set");
          const decisions = await access.authorizeAccounts({
            ...request,
            accountIds: accounts.map(accountId),
          });
          return new Map(
            [...decisions].map(([id, decision]) => [id, outcome(decision)]),
          );
        },
      },
      recipients: {
        ...recipients,
        bindings: async (accounts, source) => {
          bindingSetCalls++;
          if (recipients.bindings === undefined)
            throw new Error("Missing binding set");
          return recipients.bindings(accounts, source);
        },
      },
    };
    app = new Notifications(deps, accounts);
    await app.acceptEvent(encodeNotification("materials", event));
  });
  afterEach(async () => {
    await observer.prisma.$disconnect();
    await audienceDatabase.dispose();
  });
  test("expands a checkpoint with owner sets while preserving denial, opt-out and continuation", async () => {
    const measured = await observer.measure(() =>
      expandAudience(deps, "materials", () => Promise.resolve()),
    );
    process.stdout.write(
      "N8 checkpoint counters " +
        JSON.stringify({
          singleAccessOwnerCalls: oneAccessCalls,
          accountSetAccessOwnerCalls: manyAccessCalls,
          bindingSetOwnerCalls: bindingSetCalls,
          sqlStatements: measured.statements.length,
          sqlSelects: measured.statements.filter((statement) =>
            statement.startsWith("SELECT"),
          ).length,
          preferenceStatements: measured.statements.filter(
            (statement) =>
              statement.includes('"notifications"."preferences"') ||
              statement.includes('"notifications"."preference_revisions"'),
          ).length,
          providerRequests: 0,
        }) +
        "\n",
    );
    expect(measured.result.progressed).toBe(true);
    expect(oneAccessCalls).toBe(0);
    expect(manyAccessCalls).toBe(1);
    expect(bindingSetCalls).toBe(1);
    const preferences = measured.statements.filter(
      (sql) =>
        sql.includes('"notifications"."preferences"') ||
        sql.includes('"notifications"."preference_revisions"'),
    );
    expect(preferences).toHaveLength(3);
    expect(await app.readDeliveries(ids[0] ?? "")).toMatchObject([
      { channel: "telegram", commandRevision: 1 },
    ]);
    expect(await app.readDeliveries(ids[1] ?? "")).toHaveLength(2);
    expect(await app.readDeliveries(ids[24] ?? "")).toHaveLength(0);
    expect(
      (await expandAudience(deps, "materials", () => Promise.resolve()))
        .progressed,
    ).toBe(true);
    expect(
      (await expandAudience(deps, "materials", () => Promise.resolve()))
        .progressed,
    ).toBe(false);
  });
  test("an unused Telegram binding failure does not block opted-in email commands", async () => {
    await audienceDatabase.prisma.notificationPreference.updateMany({
      data: { email: true, telegram: false },
    });
    await audienceDatabase.prisma.$executeRaw(
      Prisma.sql`alter table telegram_membership.account_link_states rename to unavailable_link_states`,
    );
    expect(
      (await expandAudience(deps, "materials", () => Promise.resolve()))
        .progressed,
    ).toBe(true);
    expect(await app.readDeliveries(ids[0] ?? "")).toMatchObject([
      { channel: "email", commandRevision: 1 },
    ]);
    expect(manyAccessCalls).toBe(1);
  });
  test.each(["rights", "source"] as const)(
    "refresh retains per-Delivery %s reads when a fact changes between candidates",
    async (fact) => {
      await expandAudience(deps, "materials", () => Promise.resolve());
      const recipient = ids[1] ?? "";
      const deliveries = await app.readDeliveries(recipient);
      expect(deliveries).toHaveLength(2);
      for (const [index, delivery] of deliveries.entries()) {
        const stored =
          await audienceDatabase.prisma.notificationCommand.findUniqueOrThrow({
            where: {
              deliveryId_revision: {
                deliveryId: delivery.id,
                revision: delivery.commandRevision,
              },
            },
          });
        expect(
          await app.acceptDeliveryResult(delivery.channel, {
            contractVersion: "inside.notification-result.v1",
            messageId: `ed000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            operationId: stored.operationId,
            deliveryRef: delivery.id,
            commandRevision: stored.revision,
            payloadDigest: stored.digest,
            resultRevision: 1,
            channel: delivery.channel,
            recordedAt: instant.toISOString(),
            state: "suppressed",
            reason: "superseded",
          }),
        ).toBe("accepted");
      }
      let sources = 0;
      let bindings = 0;
      const resolve = deps.sources.resolve.bind(deps.sources);
      const binding = deps.recipients.binding.bind(deps.recipients);
      deps.sources = {
        ...deps.sources,
        resolve: async (event) => {
          sources++;
          return resolve(event);
        },
      };
      deps.recipients = {
        ...deps.recipients,
        binding: async (account, channel, source) => {
          const result = await binding(account, channel, source);
          bindings++;
          if (bindings === 1) {
            if (fact === "rights")
              await audienceDatabase.prisma.productAccess.updateMany({
                where: { accountId: recipient },
                data: { revokedAt: instant },
              });
            else
              await audienceDatabase.prisma.material.update({
                where: { id: resource },
                data: { publicationState: "unpublished" },
              });
          }
          return result;
        },
      };
      const measured = await observer.measure(() => refreshDeliveries(deps));
      expect(sources).toBe(2);
      expect(oneAccessCalls).toBe(fact === "rights" ? 2 : 1);
      expect(bindings).toBe(1);
      const refreshed = await app.readDeliveries(recipient);
      expect(
        refreshed.filter((delivery) => delivery.commandRevision === 2),
      ).toHaveLength(1);
      expect(
        refreshed.filter((delivery) => delivery.commandRevision === 1),
      ).toHaveLength(1);
      expect(
        measured.statements.filter((statement) =>
          statement.startsWith("SELECT"),
        ).length,
      ).toBeGreaterThan(0);
      process.stdout.write(
        "BC4 refresh counters " +
          JSON.stringify({
            fact,
            sourceOwnerCalls: sources,
            accessOwnerCalls: oneAccessCalls,
            bindingOwnerCalls: bindings,
            sqlStatements: measured.statements.length,
            sqlSelects: measured.statements.filter((statement) =>
              statement.startsWith("SELECT"),
            ).length,
            providerRequests: 0,
          }) +
          "\n",
      );
    },
  );
  test("retries a checkpoint at the first unavailable Account without duplicating earlier commands", async () => {
    const readSet = deps.sources.canReadAccounts?.bind(deps.sources);
    if (readSet === undefined) throw new Error("Missing access set");
    deps.sources = {
      ...deps.sources,
      canReadAccounts: async (accounts, sourceRef) => {
        const decisions = new Map(await readSet(accounts, sourceRef));
        decisions.set(ids[1] ?? "", "unavailable");
        return decisions;
      },
    };
    expect(
      (await expandAudience(deps, "materials", () => Promise.resolve()))
        .progressed,
    ).toBe(false);
    expect(await app.readDeliveries(ids[0] ?? "")).toHaveLength(1);
    expect(await app.readDeliveries(ids[1] ?? "")).toHaveLength(0);
    deps.sources = { ...deps.sources, canReadAccounts: readSet };
    deps.now = () => new Date(instant.getTime() + 31_000);
    expect(
      (await expandAudience(deps, "materials", () => Promise.resolve()))
        .progressed,
    ).toBe(true);
    expect(await app.readDeliveries(ids[0] ?? "")).toHaveLength(1);
    expect(await app.readDeliveries(ids[1] ?? "")).toHaveLength(2);
    expect(manyAccessCalls).toBe(2);
  });
  test.each(["preferences", "rights", "link", "source"] as const)(
    "rechecks %s at dispatch after a checkpoint approved the recipient",
    async (fact) => {
      await expandAudience(deps, "materials", () => Promise.resolve());
      const recipient = ids[0] ?? "";
      const deliveries = await app.readDeliveries(recipient);
      const delivery = deliveries[0];
      if (delivery === undefined) throw new Error("Missing approved delivery");
      const stored =
        await audienceDatabase.prisma.notificationCommand.findUniqueOrThrow({
          where: {
            deliveryId_revision: {
              deliveryId: delivery.id,
              revision: delivery.commandRevision,
            },
          },
        });
      if (fact === "preferences")
        await app.changePreferences(recipient, {
          operationId: "aa000000-0000-4000-8000-000000000001",
          expectedRevision: 1,
          email: false,
          telegram: false,
        });
      if (fact === "rights")
        await audienceDatabase.prisma.productAccess.updateMany({
          where: { accountId: recipient },
          data: { revokedAt: instant },
        });
      if (fact === "link")
        await audienceDatabase.prisma.telegramAccountLinkState.update({
          where: { accountId: recipient },
          data: {
            revision: 2,
            identityRef: "transferred-identity",
            principalRef: "transferred-account",
            updatedAt: instant,
          },
        });
      if (fact === "source")
        await audienceDatabase.prisma.material.update({
          where: { id: resource },
          data: { publicationState: "unpublished" },
        });
      const response = await app.authorizeDispatch("telegram", {
        contractVersion: "inside.notification-dispatch.v1",
        operationId: "ab000000-0000-4000-8000-000000000001",
        deliveryOperationId: stored.operationId,
        deliveryRef: delivery.id,
        commandRevision: stored.revision,
        payloadDigest: stored.digest,
        attemptRef: "ac000000-0000-4000-8000-000000000001",
      });
      expect(response).toMatchObject({
        status: "denied",
        reason: (
          {
            preferences: "preference_disabled",
            rights: "access_denied",
            link: "binding_conflict",
            source: "superseded",
          } as const
        )[fact],
      });
      expect(manyAccessCalls).toBe(1);
    },
  );
});

describe("resource-aware Account set mixed grounds", () => {
  let mixed: TestDatabase;
  const ids = Array.from({ length: 12 }, (_, index) =>
    accountId(`bd000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
  );
  const product = "be000000-0000-4000-8000-000000000001";
  const resource = "bf000000-0000-4000-8000-000000000001";
  beforeEach(async () => {
    mixed = await createMigratedTestDatabase();
    const prisma = mixed.prisma;
    await prisma.account.createMany({
      data: ids.map((id) => ({
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
        createdAt: instant,
      })),
    });
    await prisma.product.createMany({
      data: [product, material].map((id) => ({ id, slug: id, name: id })),
    });
    await prisma.productAccess.createMany({
      data: [0, 1, 2, 6, 7, 9].map((index) => ({
        accountId: ids[index] ?? "",
        productId: index === 6 ? material : product,
        firstIssuedAt: instant,
        revokedAt: [1, 9].includes(index) ? instant : null,
        revision: 1,
      })),
    });
    await prisma.legacyClassification.createMany({
      data: [3, 4, 5, 11].map((index) => ({
        accountId: ids[index] ?? "",
        classification: "confirmed_legacy",
        sourceRef: `passive-${index}`,
        reason: "Passive bridge",
        verifiedAt: instant,
        revision: 1,
        bridgeEnabled: true,
        bridgeCoverage: { productIds: [product], materialIds: [] },
      })),
    });
  });
  afterEach(async () => {
    await mixed.dispose();
  });
  test("preserves lifetime rights, revocation, Product isolation and passive bridge denial", async () => {
    const rights = assembleAccountRights({
      prisma: mixed.prisma,
      clock: () => instant,
    });
    if (rights.resolveForAccessAccounts === undefined)
      throw new Error("Missing scoped set owner");
    const result = await rights.resolveForAccessAccounts(
      ids,
      [product],
      resource,
    );
    expect([...result.values()]).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((index) =>
        [0, 2, 7].includes(index)
          ? { kind: "active", validUntil: null }
          : { kind: "required" },
      ),
    );
    const expected = [];
    for (const id of ids)
      expected.push(await rights.resolveForAccess(id, [product], resource));
    expect([...result.values()]).toEqual(expected);
  });
});

describe("Account-set empty, missing and unavailable contracts", () => {
  let owned: TestDatabase;
  let observer: ReturnType<typeof createQueryEventClient>;
  const missing = accountId("DA000000-0000-4000-8000-000000000001");
  beforeEach(async () => {
    owned = await createMigratedTestDatabase();
    observer = createQueryEventClient(owned.url);
  });
  afterEach(async () => {
    await observer.prisma.$disconnect();
    await owned.dispose();
  });
  function owners() {
    const accounts = assembleAccounts({
      prisma: observer.prisma,
      emailFingerprintKey: "synthetic-email-fingerprint-key-123456",
    });
    const rights = assembleAccountRights({
      prisma: observer.prisma,
      clock: () => instant,
    });
    const access = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        composeMaterialAccessFacts(
          assembleMaterialContent({
            prisma: observer.prisma,
            materialBodyOperations,
          }),
          new ProductCatalogue(observer.prisma),
        ),
      ),
      accountPermissions: assembleCurrentAccountPermissions(accounts),
      accountRights: rights,
      clock: () => instant,
    });
    const permissions = accounts.checkPermissionsMany?.bind(accounts);
    const membership = rights.resolveForAccessAccounts?.bind(rights);
    const authorize = access.authorizeAccounts?.bind(access);
    if (
      permissions === undefined ||
      membership === undefined ||
      authorize === undefined
    )
      throw new Error("Missing Account-set owners");
    return { permissions, membership, authorize };
  }
  const request = {
    resource: { kind: "material" as const, materialId: materialId(material) },
    action: "read" as const,
    enforcementPoint: "published_material_read" as const,
    correlationId: "synthetic-empty",
  };
  test("empty sets perform no SQL and missing keys remain associated with requested spelling", async () => {
    const { permissions, membership, authorize } = owners();
    const empty = await observer.measure(async () => [
      await permissions({ accountIds: [], permission: "materials:manage" }),
      await membership([], [], material),
      await authorize({ ...request, accountIds: [] }),
    ]);
    expect(empty.result.map((result) => result.size)).toEqual([0, 0, 0]);
    expect(empty.statements).toHaveLength(0);
    expect(
      await permissions({
        accountIds: [missing],
        permission: "materials:manage",
      }),
    ).toEqual(
      new Map([[missing, { ok: false, error: { code: "account_not_found" } }]]),
    );
    expect(await membership([missing], [], material)).toEqual(
      new Map([[missing, { kind: "required" }]]),
    );
    const denied = await authorize({ ...request, accountIds: [missing] });
    expect(denied.get(missing)).toMatchObject({
      effect: "deny",
      reason: "resource_not_found",
    });
  });
  test("SQL unavailability fails closed through each owning capability", async () => {
    await owned.prisma.account.create({
      data: {
        id: missing,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: missing,
        createdAt: instant,
      },
    });
    await owned.prisma.$executeRaw(
      Prisma.sql`alter table accounts.account_permissions rename to unavailable_permissions`,
    );
    await owned.prisma.$executeRaw(
      Prisma.sql`alter table account_rights.product_access rename to unavailable_access`,
    );
    await owned.prisma.$executeRaw(
      Prisma.sql`alter table materials.materials rename to unavailable_materials`,
    );
    const { permissions, membership, authorize } = owners();
    expect(
      (
        await permissions({
          accountIds: [missing],
          permission: "materials:manage",
        })
      ).get(missing),
    ).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(await membership([missing], [], material)).toEqual(
      new Map([[missing, { kind: "unavailable" }]]),
    );
    expect(
      (await authorize({ ...request, accountIds: [missing] })).get(missing),
    ).toMatchObject({ effect: "deny", reason: "dependency_unavailable" });
  });
});

describe("resource-aware set committed state", () => {
  let owned: TestDatabase;
  const recipient = accountId("dc000000-0000-4000-8000-000000000001");
  beforeEach(async () => {
    owned = await createMigratedTestDatabase();
    await owned.prisma.account.create({
      data: {
        id: recipient,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: recipient,
      },
    });
    await owned.prisma.product.create({
      data: { id: material, slug: "committed-state", name: "Committed state" },
    });
  });
  afterEach(async () => owned.dispose());
  test("an uncommitted issuance is invisible and becomes visible after commit", async () => {
    const rights = assembleAccountRights({
      prisma: owned.prisma,
      clock: () => instant,
    });
    const read = () =>
      outsideTransaction(() =>
        rights.resolveForAccessAccounts([recipient], [material]),
      );
    await owned.prisma.$transaction(async (tx) => {
      await tx.productAccess.create({
        data: {
          accountId: recipient,
          productId: material,
          firstIssuedAt: instant,
          revision: 1,
        },
      });
      expect(await read()).toEqual(
        new Map([[recipient, { kind: "required" }]]),
      );
    });
    expect(await read()).toEqual(
      new Map([[recipient, { kind: "active", validUntil: null }]]),
    );
  });
  test("an uncommitted withdrawal cannot tear the current Account set", async () => {
    await grantProductFixture(owned.prisma, recipient, material);
    const rights = assembleAccountRights({
      prisma: owned.prisma,
      clock: () => instant,
    });
    const read = () =>
      outsideTransaction(() =>
        rights.resolveForAccessAccounts([recipient], [material]),
      );
    await owned.prisma.$transaction(async (tx) => {
      await tx.productAccess.update({
        where: {
          accountId_productId: { accountId: recipient, productId: material },
        },
        data: { revokedAt: instant, revision: 2 },
      });
      expect(await read()).toEqual(
        new Map([[recipient, { kind: "active", validUntil: null }]]),
      );
    });
    expect(await read()).toEqual(new Map([[recipient, { kind: "required" }]]));
  });
});

describe("many-Account Product exclusion parity", () => {
  let owned: TestDatabase;
  const ids = [1, 2, 3, 4].map((index) =>
    accountId(`de000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
  );
  const product = "df000000-0000-4000-8000-000000000001";
  const other = "df000000-0000-4000-8000-000000000002";
  beforeEach(async () => {
    owned = await createMigratedTestDatabase();
    await owned.prisma.product.createMany({
      data: [product, other].map((id) => ({ id, slug: id, name: id })),
    });
    for (const id of ids)
      for (const productId of [product, other])
        await grantProductFixture(owned.prisma, id, productId);
    for (const id of ids.slice(0, 3))
      await revokeProductFixture(owned.prisma, `${id}:${product}`);
    // An independent later source must preserve the owner's withdrawal latch.
    await grantProductFixture(owned.prisma, ids[2] ?? "", product);
  });
  afterEach(async () => {
    await owned.dispose();
  });
  test("honours revocation across later sources without denying another Product or Account", async () => {
    const rights = assembleAccountRights({
      prisma: owned.prisma,
      clock: () => instant,
    });
    if (rights.resolveForAccessAccounts === undefined)
      throw new Error("Missing scoped owner set");
    const requested = [accountId((ids[0] ?? "").toUpperCase()), ...ids];
    const excluded = await rights.resolveForAccessAccounts(requested, [
      product,
    ]);
    expect([...excluded.values()]).toEqual([
      { kind: "required" },
      { kind: "required" },
      { kind: "required" },
      { kind: "required" },
      { kind: "active", validUntil: null },
    ]);
    const expected = [];
    for (const id of requested)
      expected.push(await rights.resolveForAccess(id, [product]));
    expect([...excluded.values()]).toEqual(expected);
    const allowed = await rights.resolveForAccessAccounts(ids, [other]);
    expect([...allowed.values()]).toEqual(
      ids.map(() => ({
        kind: "active",
        validUntil: null,
      })),
    );
  });
});
