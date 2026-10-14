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
import { createQueryEventClient } from "./setup/query-events.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { NotificationAccounts } from "../../src/modules/accounts/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
let database: TestDatabase;
const instant = new Date("2030-01-01T00:00:00Z");
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});
describe("projects current verified email and Telegram bindings for 25 recipients through their owners", () => {
  const ids = Array.from(
    { length: 25 },
    (_, index) =>
      `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
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
    await database.prisma.billingContact.createMany({
      data: ids.slice(0, 24).map((id, index) => ({
        accountId: id,
        revision: index === 23 ? 0 : 3,
        emailCiphertext: index === 23 ? null : "synthetic_ciphertext",
        verifiedAt: index === 23 ? null : instant,
      })),
    });
    await database.prisma.telegramAccountLinkState.createMany({
      data: ids.slice(0, 24).map((id, index) => ({
        accountId: id,
        linkRef: `91000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        revision: 4,
        principalRef: index === 23 ? null : id,
        identityRef: index === 23 ? null : `identity-${index}`,
        updatedAt: instant,
      })),
    });
  });
  test("preserves facts with bounded owner SQL", async () => {
    const observer = createQueryEventClient(database.url);
    try {
      const contacts = new NotificationAccounts(observer.prisma, undefined);
      const telegram = new TelegramAccountLinks(observer.prisma);
      const baseline = await observer.measure(async () => {
        const result = [];
        for (const id of ids)
          result.push({
            email: await contacts.binding(id),
            telegram: await telegram.readBinding({ accountId: id }),
          });
        return result;
      });
      const after = await observer.measure(async () => ({
        email: await contacts.bindings(ids),
        telegram: await telegram.readBindings(ids),
      }));
      expect(after.result.telegram.ok).toBe(true);
      if (!after.result.telegram.ok) throw new Error("Bindings unavailable");
      expect(
        ids.map((id) => ({
          email: after.result.email.get(id),
          telegram: {
            ok: true,
            binding: after.result.telegram.ok
              ? after.result.telegram.bindings.get(id)
              : null,
          },
        })),
      ).toEqual(baseline.result);
      expect(
        baseline.statements.filter((sql) => sql.startsWith("SELECT")),
      ).toHaveLength(50);
      expect(
        after.statements.filter((sql) => sql.startsWith("SELECT")),
      ).toHaveLength(2);
      expect(after.result.email.get(ids[24] ?? "")).toBeNull();
    } finally {
      await observer.prisma.$disconnect();
    }
  });
});

describe("requested UUID binding association", () => {
  const id = "bc000000-0000-4000-8000-000000000001";
  const absent = "bc000000-0000-4000-8000-000000000002";
  beforeEach(async () => {
    await database.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
        createdAt: instant,
      },
    });
    await database.prisma.billingContact.create({
      data: {
        accountId: id,
        revision: 2,
        emailCiphertext: "synthetic_ciphertext",
        verifiedAt: instant,
      },
    });
    await database.prisma.telegramAccountLinkState.create({
      data: {
        accountId: id,
        linkRef: "bd000000-0000-4000-8000-000000000001",
        revision: 3,
        principalRef: "opaque-account",
        identityRef: "opaque-identity",
        updatedAt: instant,
      },
    });
  });
  test("keeps uppercase, ordered, duplicate and missing requests associated with their own rows", async () => {
    const observer = createQueryEventClient(database.url);
    try {
      const contacts = new NotificationAccounts(observer.prisma, undefined);
      const links = new TelegramAccountLinks(observer.prisma);
      const requested = [
        absent.toUpperCase(),
        id.toUpperCase(),
        id,
        id.toUpperCase(),
      ];
      const baseline = [];
      for (const request of requested)
        baseline.push({
          email: await contacts.binding(request),
          telegram: await links.readBinding({ accountId: request }),
        });
      const result = await observer.measure(async () => ({
        email: await contacts.bindings(requested),
        telegram: await links.readBindings(requested),
      }));
      if (!result.result.telegram.ok)
        throw new Error("Binding set unavailable");
      const telegram = result.result.telegram.bindings;
      expect(
        requested.map((key) => ({
          email: result.result.email.get(key),
          telegram: { ok: true, binding: telegram.get(key) },
        })),
      ).toEqual(baseline);
      expect([...result.result.email.keys()]).toEqual([
        absent.toUpperCase(),
        id.toUpperCase(),
        id,
      ]);
      expect(
        result.statements.filter((sql) => sql.startsWith("SELECT")),
      ).toHaveLength(2);
      expect(await contacts.bindings([])).toEqual(new Map());
      expect(await links.readBindings([])).toEqual({
        ok: true,
        bindings: new Map(),
      });
      expect(await links.readBindings(["bad-uuid"])).toEqual({ ok: false });
    } finally {
      await observer.prisma.$disconnect();
    }
  });
});

describe("current binding dependency failure", () => {
  beforeEach(async () => {
    await database.prisma.$executeRaw(
      Prisma.sql`alter table telegram_membership.account_link_states rename to unavailable_binding_states`,
    );
  });
  afterEach(async () => {
    await database.prisma.$executeRaw(
      Prisma.sql`alter table telegram_membership.unavailable_binding_states rename to account_link_states`,
    );
  });
  test("fails the binding set without inventing a missing identity when PostgreSQL cannot read current bindings", async () => {
    const links = new TelegramAccountLinks(database.prisma);
    expect(
      await links.readBindings(["bf000000-0000-4000-8000-000000000001"]),
    ).toEqual({ ok: false });
  });
});
