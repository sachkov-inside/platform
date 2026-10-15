import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import type { TelegramContactsProvider } from "../../src/modules/telegram-membership/ports/telegram-contacts-provider.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryRowClient } from "./setup/query-rows.js";

describe("BC-2 contact association through the public owner", () => {
  let db: TestDatabase;
  let measured: ReturnType<typeof createQueryRowClient>;
  const groups = [1, 50, 100].map((size) => ({
    size,
    ids: Array.from({ length: size }, () => randomUUID()),
  }));
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    measured = createQueryRowClient(db.url);
    const ids = groups.flatMap((group) => group.ids);
    await db.prisma.account.createMany({
      data: ids.map((id) => ({
        id,
        logtoIssuer: "https://contact-joins.test",
        logtoSubject: id,
      })),
    });
    await db.prisma.telegramAccountLinkState.createMany({
      data: ids.map((id, index) => ({
        accountId: id,
        linkRef: randomUUID(),
        revision: 1,
        principalRef:
          index === 1
            ? "principal:A:B"
            : index === 2
              ? "principal:A"
              : `Principal:${id.toUpperCase()}`,
        identityRef:
          index === 1
            ? "opaque:C"
            : index === 2
              ? "B:opaque:C"
              : `Identity:${id}`,
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      })),
    });
  });
  afterAll(async () => {
    await measured.prisma.$disconnect();
    await db.dispose();
  });

  test.each(groups)(
    "preserves requested order and opaque pairs at $size contacts",
    async ({ size, ids }) => {
      let providerPortCalls = 0;
      const provider: TelegramContactsProvider = {
        read(queries) {
          providerPortCalls++;
          return Promise.resolve({
            ok: true,
            contacts: queries
              .map((query) => ({
                ...query,
                status: "available" as const,
                displayName: `Learner:${query.telegramIdentityRef}`,
                username: null,
              }))
              .reverse(),
          });
        },
      };
      const links = new TelegramAccountLinks(measured.prisma, provider);
      const bindings = vi.spyOn(links, "readBinding");
      const requested = size === 1 ? ids.map((id) => id.toUpperCase()) : ids;
      const reading = await measured.measure(() =>
        links.readContacts(requested),
      );
      expect(reading.result.ok).toBe(true);
      if (!reading.result.ok) return;
      expect([...reading.result.contacts.keys()]).toEqual(requested);
      for (const contact of reading.result.contacts.values()) {
        expect(contact.telegramContactState).toBe("available");
        expect(contact.displayName).toBe(
          `Learner:${contact.telegramIdentityRef}`,
        );
      }
      const statements = reading.statements.filter((sql) =>
        sql.trimStart().startsWith("SELECT"),
      );
      const returnedRows = reading.rows.reduce(
        (sum, query) => sum + query.count,
        0,
      );
      process.stdout.write(
        `${JSON.stringify({ record: "BC-2", owner: "TelegramAccountLinks.readContacts", size, bindingOwnerCalls: bindings.mock.calls.length, sqlStatements: statements.length, providerPortCalls, physicalProviderHttpRequests: 0, returnedRows, returnedBytes: reading.rows.reduce((sum, query) => sum + query.serializedBytes, 0), processCpu: reading.processCpu, elapsedMs: reading.elapsedMs })}\n`,
      );
      expect(bindings).toHaveBeenCalledTimes(2 * size);
      expect(statements).toHaveLength(2);
      expect(returnedRows).toBe(2 * size);
      expect(providerPortCalls).toBe(1);
      bindings.mockRestore();
    },
  );

  test("duplicate provider pairs remain ambiguous and a changed binding cannot reveal an old profile", async () => {
    const id = groups[0]?.ids[0];
    if (id === undefined) throw new Error("Missing fixture Account");
    const duplicates: TelegramContactsProvider = {
      read(queries) {
        const query = queries[0];
        if (query === undefined) throw new Error("Missing provider query");
        const contact = {
          ...query,
          status: "available" as const,
          displayName: "Old profile",
          username: null,
        };
        return Promise.resolve({
          ok: true as const,
          contacts: [contact, contact],
        });
      },
    };
    const ambiguous = await new TelegramAccountLinks(
      measured.prisma,
      duplicates,
    ).readContacts([id]);
    expect(ambiguous.ok && ambiguous.contacts.get(id)).toMatchObject({
      displayName: null,
      telegramContactState: "unavailable",
    });
    const changed: TelegramContactsProvider = {
      async read(queries) {
        await db.prisma.telegramAccountLinkState.update({
          where: { accountId: id },
          data: { revision: 2, identityRef: "New:opaque:identity" },
        });
        return {
          ok: true,
          contacts: queries.map((query) => ({
            ...query,
            status: "available" as const,
            displayName: "Old profile",
            username: null,
          })),
        };
      },
    };
    const stale = await new TelegramAccountLinks(
      measured.prisma,
      changed,
    ).readContacts([id]);
    expect(stale.ok && stale.contacts.get(id)).toMatchObject({
      telegramIdentityRef: "New:opaque:identity",
      displayName: null,
      telegramContactState: "unavailable",
    });
  });
});
