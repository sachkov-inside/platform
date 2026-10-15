import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  type Accounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { z } from "zod";
import {
  Prisma,
  lockAccountEntitlementChanges,
} from "../../src/infrastructure/prisma/index.js";
import { createQueryEventClient } from "./setup/query-events.js";

describe.each([1, 50, 100])(
  "Grant batch target identities: %i Accounts",
  (size) => {
    let db: TestDatabase | undefined;
    let measured: ReturnType<typeof createQueryEventClient> | undefined;
    let grants: AccessGrants;
    let owner: string;
    let previewRef: string;
    let identityOwnerCalls = 0;
    let rows: {
      rowKey: string;
      accountId: string;
      source: "manual";
      sourceRef: string;
      terms: {
        capabilities: ["community"];
        startsAt: string;
        validUntil: string;
        reason: string;
      };
    }[];
    beforeAll(async () => {
      db = await createMigratedTestDatabase();
      measured = createQueryEventClient(db.url);
      owner = (
        await bootstrapOwnerAccount(
          db.prisma,
          { issuer: "https://grant-identities.test", subject: "owner" },
          "platform:admin",
        )
      ).accountId;
      const ids = Array.from({ length: size }, () => randomUUID());
      await db.prisma.account.createMany({
        data: ids.map((id) => ({
          id,
          logtoIssuer: "https://grant-identities.test",
          logtoSubject: id,
        })),
      });
      const accounts = assembleAccounts({
        prisma: measured.prisma,
        emailFingerprintKey: "grant-identity-set-fixture-fingerprint-key",
      });
      grants = assembleAccessGrants({
        prisma: measured.prisma,
        accounts: {
          ...accounts,
          readIdentityForLink: (
            ...args: Parameters<Accounts["readIdentityForLink"]>
          ) => {
            identityOwnerCalls += 1;
            return accounts.readIdentityForLink(...args);
          },
          readIdentitiesForLink: (
            ...args: Parameters<Accounts["readIdentitiesForLink"]>
          ) => {
            identityOwnerCalls += 1;
            return accounts.readIdentitiesForLink(...args);
          },
        },
        clock: () => new Date("2030-01-01T00:00:00.000Z"),
      });
      rows = ids.map((id, index) => ({
        rowKey: `row-${index}`,
        accountId: index % 2 === 0 ? id.toUpperCase() : id,
        source: "manual",
        sourceRef: randomUUID(),
        terms: {
          capabilities: ["community"],
          startsAt: "2030-01-01T00:00:00.000Z",
          validUntil: "2030-02-01T00:00:00.000Z",
          reason: "Identity fixture",
        },
      }));
      const preview = await grants.previewBatch(owner, {
        operationId: randomUUID(),
        rows: rows.map((row) => ({
          ...row,
          accountId: row.accountId.toLowerCase(),
        })),
      });
      if (!preview.ok) throw new Error("Missing prepared preview");
      previewRef = preview.previewRef;
    });
    afterAll(async () => {
      await measured?.prisma.$disconnect();
      await db?.dispose();
    });
    test("preview confirms the target set with bounded identity statements", async () => {
      if (measured === undefined) throw new Error("Missing fixture client");
      identityOwnerCalls = 0;
      const read = await measured.measure(() =>
        grants.previewBatch(owner, {
          operationId: randomUUID(),
          rows: rows.map((row) => ({ ...row, sourceRef: randomUUID() })),
        }),
      );
      process.stdout.write(
        `${JSON.stringify({ record: "BC-1", operation: "preview", size, identityOwnerCalls, identitySql: read.statements.filter((sql) => sql.includes('"accounts"."accounts"') && sql.includes('"logto_issuer"')).length, providerRequests: 0 })}\n`,
      );
      expect(identityOwnerCalls).toBe(1);
      expect(
        read.result.ok && read.result.rows.map((row) => row.status),
      ).toEqual(Array.from({ length: size }, () => "confirmed"));
      expect(
        read.statements.filter(
          (sql) =>
            sql.includes('"accounts"."accounts"') &&
            sql.includes('"logto_issuer"'),
        ).length,
      ).toBe(1);
    });
    test("apply validates the selected identity set before ordered grant writes", async () => {
      if (measured === undefined) throw new Error("Missing fixture client");
      identityOwnerCalls = 0;
      const read = await measured.measure(() =>
        grants.applyBatch(owner, {
          operationId: randomUUID(),
          previewRef,
          expectedRevision: 1,
          confirmedRows: rows.map((row) => row.rowKey),
        }),
      );
      process.stdout.write(
        `${JSON.stringify({ record: "BC-1", operation: "apply", size, identityOwnerCalls, identitySql: read.statements.filter((sql) => sql.includes('"accounts"."accounts"') && sql.includes('"logto_issuer"')).length, providerRequests: 0 })}\n`,
      );
      expect(identityOwnerCalls).toBe(1);
      expect(read.result.ok).toBe(true);
      if (read.result.ok) expect(read.result.rows.length).toBe(size);
      expect(
        read.statements.filter(
          (sql) =>
            sql.includes('"accounts"."accounts"') &&
            sql.includes('"logto_issuer"'),
        ).length,
      ).toBe(1);
    });
    if (size === 1)
      test("uppercase target aliases retain the Account entitlement write lock", async () => {
        if (db === undefined) throw new Error("Missing fixture database");
        const row = rows[0];
        if (row === undefined) throw new Error("Missing fixture Account");
        const preview = await grants.previewBatch(owner, {
          operationId: randomUUID(),
          rows: [
            {
              ...row,
              accountId: row.accountId.toUpperCase(),
              sourceRef: randomUUID(),
            },
          ],
        });
        expect(preview.ok && preview.rows[0]?.status).toBe("confirmed");
        if (!preview.ok) return;
        const held = signal();
        const release = signal();
        const blocker = db.prisma.$transaction(async (transaction) => {
          await lockAccountEntitlementChanges(
            transaction,
            row.accountId.toLowerCase(),
          );
          held.resolve();
          await release.promise;
        });
        await held.promise;
        let applying: ReturnType<AccessGrants["applyBatch"]> | undefined;
        try {
          applying = grants.applyBatch(owner, {
            operationId: randomUUID(),
            previewRef: preview.previewRef,
            expectedRevision: preview.revision,
            confirmedRows: [row.rowKey],
          });
          await expect
            .poll(async () => {
              if (db === undefined) throw new Error("Missing fixture database");
              return z
                .array(z.object({ waiting: z.boolean() }))
                .parse(
                  await db.prisma.$queryRaw(
                    Prisma.sql`select exists(select 1 from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())) as waiting`,
                  ),
                )[0]?.waiting;
            })
            .toBe(true);
        } finally {
          release.resolve();
          await blocker;
          await applying;
        }
        expect(await applying).toMatchObject({ ok: true });
      });
    if (size === 1)
      test("one Account cannot be classified twice through UUID spelling aliases", async () => {
        const row = rows[0];
        if (row === undefined) throw new Error("Missing fixture Account");
        const input = {
          operationId: randomUUID(),
          rows: [row.accountId.toLowerCase(), row.accountId.toUpperCase()].map(
            (accountId, index) => ({
              rowKey: `alias-${index}`,
              accountId,
              expectedRevision: 0,
              classification: "confirmed_new" as const,
              sourceRef: randomUUID(),
              reason: "One physical Account per classification batch",
              bridgeEnabled: false,
              tributeStopped: false,
            }),
          ),
        };
        expect(await grants.previewBatch(owner, input)).toEqual({
          ok: false,
          error: { code: "invalid_input" },
        });
      });
    if (size === 1)
      test("a saved classification preview with two UUID aliases is rejected before any write", async () => {
        if (db === undefined) throw new Error("Missing fixture database");
        const row = rows[0];
        if (row === undefined) throw new Error("Missing fixture Account");
        const preview = await grants.previewBatch(owner, {
          operationId: randomUUID(),
          rows: [
            {
              rowKey: "saved-alias-1",
              accountId: row.accountId.toLowerCase(),
              expectedRevision: 0,
              classification: "confirmed_new",
              sourceRef: randomUUID(),
              reason: "Saved preview compatibility",
              bridgeEnabled: false,
              tributeStopped: false,
            },
          ],
        });
        expect(preview.ok).toBe(true);
        if (!preview.ok) return;
        const stored = await db.prisma.accessBatchPreview.findUniqueOrThrow({
          where: { id: preview.previewRef },
        });
        const storedRows = z
          .array(z.record(z.string(), z.json()))
          .parse(stored.rows);
        const original = storedRows[0];
        if (original === undefined)
          throw new Error("Missing saved preview row");
        await db.prisma.accessBatchPreview.update({
          where: { id: preview.previewRef },
          data: {
            rows: [
              original,
              {
                ...original,
                accountId: row.accountId.toUpperCase(),
                rowKey: "saved-alias-2",
              },
            ],
          },
        });
        expect(
          await grants.applyBatch(owner, {
            operationId: randomUUID(),
            previewRef: preview.previewRef,
            expectedRevision: preview.revision,
            confirmedRows: ["saved-alias-1", "saved-alias-2"],
          }),
        ).toEqual({ ok: false, error: { code: "invalid_input" } });
        expect(
          await db.prisma.legacyClassification.count({
            where: { accountId: row.accountId },
          }),
        ).toBe(0);
      });
  },
);

function signal() {
  let resolve: () => void = () => {
    throw new Error("Barrier not initialized");
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
