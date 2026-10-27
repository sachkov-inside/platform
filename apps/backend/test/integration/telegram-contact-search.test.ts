import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import type { TelegramContactsProvider } from "../../src/modules/telegram-membership/ports/telegram-contacts-provider.js";
import { telegramWithoutContactsV2 } from "../support/telegram-contacts-v1.js";
import { createQueryRowClient } from "./setup/query-rows.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const updatedAt = new Date("2030-01-01T00:00:00.000Z");
const current = randomUUID();
const transferred = randomUUID();
const ambiguousFirst = randomUUID();
const ambiguousSecond = randomUUID();
const unlinked = randomUUID();
const stopped = randomUUID();

function match(accountRef: string, telegramIdentityRef: string) {
  return {
    accountRef,
    telegramIdentityRef,
    displayName: `Name ${telegramIdentityRef}`,
    username: null,
  };
}

describe("Telegram contact search and linked set through the public owner", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    const link = (
      accountId: string,
      principalRef: string | null,
      identityRef: string | null,
    ) => ({
      accountId,
      linkRef: randomUUID(),
      revision: 1,
      principalRef,
      identityRef,
      updatedAt,
    });
    await db.prisma.telegramAccountLinkState.createMany({
      data: [
        link(current, "principal:current", "identity:current"),
        // Transferred: Telegram's answer still names the former principal of this identity.
        link(transferred, "principal:target", "identity:transferred"),
        // One identity confirmed for two Accounts resolves to none.
        link(ambiguousFirst, "principal:first", "identity:ambiguous"),
        link(ambiguousSecond, "principal:second", "identity:ambiguous"),
        link(unlinked, null, null),
        link(stopped, "principal:stopped", "identity:stopped"),
      ],
    });
  });
  afterAll(async () => {
    await db.dispose();
  });

  const searching = (
    search: TelegramContactsProvider["search"],
  ): TelegramContactsProvider => ({
    ...telegramWithoutContactsV2,
    read: () => Promise.resolve({ ok: false }),
    search,
  });

  test("keeps only matches that are the current unambiguous link of one Account", async () => {
    const search = vi
      .fn<TelegramContactsProvider["search"]>()
      .mockResolvedValue({
        ok: true,
        matches: [
          match("principal:current", "identity:current"),
          match("principal:source", "identity:transferred"),
          match("principal:first", "identity:ambiguous"),
          match("principal:unlinked", "identity:unlinked"),
          match("principal:current", "identity:current"),
        ],
        truncated: true,
      });
    const links = new TelegramAccountLinks(db.prisma, searching(search));
    await expect(links.searchContacts("@Name", 5)).resolves.toEqual({
      ok: true,
      hits: [
        {
          accountId: current,
          displayName: "Name identity:current",
          username: null,
        },
      ],
      truncated: true,
    });
    expect(search).toHaveBeenCalledWith("@Name", 5);
  });

  test.each(["not_supported", "unavailable"] as const)(
    "reports %s instead of an empty result",
    async (reason) => {
      const links = new TelegramAccountLinks(
        db.prisma,
        searching(() => Promise.resolve({ ok: false, reason })),
      );
      await expect(links.searchContacts("Name", 5)).resolves.toEqual({
        ok: false,
        reason,
      });
    },
  );

  test.each([
    ["empty query", " @ ", 5],
    ["zero limit", "Name", 0],
    ["limit above the contract", "Name", 51],
  ])("refuses %s before calling Telegram", async (_case, query, limit) => {
    const search = vi.fn<TelegramContactsProvider["search"]>();
    const links = new TelegramAccountLinks(db.prisma, searching(search));
    await expect(links.searchContacts(query, limit)).resolves.toEqual({
      ok: false,
      reason: "invalid_query",
    });
    expect(search).not.toHaveBeenCalled();
  });

  test("reads the /stop state through v2 and falls back to v1 on an older Telegram", async () => {
    const answer = (marketing: "enabled" | "stopped") =>
      ({
        accountRef: "principal:stopped",
        telegramIdentityRef: "identity:stopped",
        status: "available",
        displayName: "Анна",
        username: "anna_example",
        marketing,
      }) as const;
    const v2: TelegramContactsProvider = {
      read: () => Promise.reject(new Error("v1 must not be read")),
      readWithMarketing: () =>
        Promise.resolve({ ok: true, contacts: [answer("stopped")] }),
      search: () => Promise.reject(new Error("unused")),
    };
    const withV2 = await new TelegramAccountLinks(
      db.prisma,
      v2,
    ).readContactsWithMarketing([stopped, unlinked]);
    expect(withV2.ok && Object.fromEntries(withV2.contacts)).toEqual({
      [stopped]: {
        telegramIdentityRef: "identity:stopped",
        displayName: "Анна",
        telegramUsername: "anna_example",
        telegramUrl: "https://t.me/anna_example",
        telegramContactState: "available",
        marketing: "stopped",
      },
      [unlinked]: {
        telegramIdentityRef: null,
        displayName: null,
        telegramUsername: null,
        telegramUrl: null,
        telegramContactState: "not_linked",
        marketing: "unknown",
      },
    });
    const { marketing: _v2Only, ...v1Contact } = answer("enabled");
    const v1: TelegramContactsProvider = {
      ...telegramWithoutContactsV2,
      read: () => Promise.resolve({ ok: true, contacts: [v1Contact] }),
    };
    const withV1 = await new TelegramAccountLinks(
      db.prisma,
      v1,
    ).readContactsWithMarketing([stopped]);
    expect(withV1.ok && withV1.contacts.get(stopped)).toMatchObject({
      telegramContactState: "available",
      displayName: "Анна",
      marketing: "unknown",
    });
    const down: TelegramContactsProvider = {
      read: () => Promise.reject(new Error("v1 must not be read")),
      readWithMarketing: () =>
        Promise.resolve({ ok: false, reason: "unavailable" }),
      search: () => Promise.reject(new Error("unused")),
    };
    const unavailable = await new TelegramAccountLinks(
      db.prisma,
      down,
    ).readContactsWithMarketing([stopped]);
    expect(unavailable.ok && unavailable.contacts.get(stopped)).toMatchObject({
      telegramContactState: "unavailable",
      displayName: null,
      marketing: "unknown",
    });
  });
});

describe("linked Account set", () => {
  let db: TestDatabase;
  let measured: ReturnType<typeof createQueryRowClient>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    measured = createQueryRowClient(db.url);
  });
  afterAll(async () => {
    await measured.prisma.$disconnect();
    await db.dispose();
  });
  const insertLinks = (count: number, linked: boolean) =>
    db.prisma.$executeRaw`
      insert into telegram_membership.account_link_states
        (account_id, link_ref, revision, principal_ref, identity_ref, updated_at)
      select gen_random_uuid(), gen_random_uuid(), 1,
        case when ${linked} then 'principal:' || n end,
        case when ${linked} then 'identity:' || n end,
        ${updatedAt}
      from generate_series(1, ${count}::int) as n`;

  test("reads every current link in bounded chunks and refuses a set beyond the bound", async () => {
    await insertLinks(12_000, true);
    await insertLinks(3, false);
    const links = new TelegramAccountLinks(measured.prisma);
    const reading = await measured.measure(() => links.listLinkedAccountIds());
    expect(reading.result.ok).toBe(true);
    if (!reading.result.ok) return;
    const expected = await db.prisma.telegramAccountLinkState.findMany({
      where: { principalRef: { not: null } },
      orderBy: { accountId: "asc" },
      select: { accountId: true },
    });
    expect(reading.result.accountIds).toEqual(
      expected.map((row) => row.accountId),
    );
    const statements = reading.statements.filter((sql) =>
      sql.trimStart().startsWith("SELECT"),
    );
    process.stdout.write(
      `${JSON.stringify({ record: "1721-linked-set", owner: "TelegramAccountLinks.listLinkedAccountIds", size: 12_000, sqlStatements: statements.length, returnedRows: reading.rows.reduce((sum, query) => sum + query.count, 0) })}\n`,
    );
    expect(statements).toHaveLength(3);

    await insertLinks(38_001, true);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(links.listLinkedAccountIds()).resolves.toEqual({ ok: false });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain(
      "linked_accounts_bound_exceeded",
    );
    log.mockRestore();
  });
});
