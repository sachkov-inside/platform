import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import {
  createPrismaClient,
  lockBillingEnrollmentNotices,
  type PlatformPrisma,
} from "../../src/infrastructure/prisma/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { knownTransactionViolations } from "./setup/known-transaction-violations.js";
import {
  guardTransactionConnections,
  outsideTransaction,
  SecondConnectionInTransactionError,
} from "./setup/transaction-guard.js";

describe("тестовая база отказывает второму соединению пула внутри транзакции", () => {
  let db: TestDatabase;
  let guarded: ReturnType<typeof guardTransactionConnections>;
  let prisma: PlatformPrisma;

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    // Свой client и страж над той же базой: отказы этих проверок не должны валить `db.dispose()`.
    guarded = guardTransactionConnections(createPrismaClient(db.url));
    prisma = guarded.prisma;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.dispose();
  });

  test("повтор #1017: чтение другого Module через корневой client под замком транзакции", async () => {
    const grants = assembleAccessGrants({
      prisma,
      accounts: assembleAccounts({
        prisma,
        emailFingerprintKey: "synthetic-guard-fingerprint-000000",
      }),
    });
    const enrollmentId = randomUUID();
    let read:
      Awaited<ReturnType<typeof grants.readEnrollmentEnding>> | undefined;

    await prisma.$transaction(async (tx) => {
      await lockBillingEnrollmentNotices(tx, enrollmentId);
      read = await grants.readEnrollmentEnding(enrollmentId);
    });

    // Фасад превращает отказ в неудачный результат; сам отказ остаётся у стража.
    expect(read).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(guarded.refused.at(-1)).toBeInstanceOf(
      SecondConnectionInTransactionError,
    );
    expect(guarded.refused.at(-1)?.message).toContain(
      "tariffAssignment.findFirst",
    );
  });

  test("запрос, $queryRaw и вложенная $transaction через корневой client падают с именованной ошибкой", async () => {
    for (const [operation, query] of [
      ["account.count", () => prisma.account.count()],
      ["$queryRaw", () => prisma.$queryRaw`SELECT 1`],
      ["$transaction", () => prisma.$transaction(() => Promise.resolve())],
    ] as const) {
      const refusal = prisma.$transaction(async () => {
        await query();
      });
      await expect(refusal).rejects.toThrow(SecondConnectionInTransactionError);
      await expect(refusal).rejects.toThrow(operation);
    }
  });

  test("транзакция, параллельная работа внутри неё и запросы после неё проходят", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const [accounts, one] = await Promise.all([
          tx.account.count(),
          tx.$queryRaw<{ one: number }[]>`SELECT 1 AS one`,
        ]);
        return { accounts, one };
      }),
    ).resolves.toEqual({ accounts: 0, one: [{ one: 1 }] });
    await expect(
      Promise.all([
        prisma.$transaction(async (tx) => tx.account.count()),
        prisma.account.count(),
      ]),
    ).resolves.toEqual([0, 0]);
    await expect(
      prisma.$transaction([prisma.account.count(), prisma.account.count()]),
    ).resolves.toEqual([0, 0]);
  });

  test("отдельный поток, начатый внутри транзакции через outsideTransaction, проходит", async () => {
    const lockKey = randomUUID();
    let contender: Promise<unknown> | undefined;
    await prisma.$transaction(async (tx) => {
      await lockBillingEnrollmentNotices(tx, lockKey);
      contender = outsideTransaction(() =>
        prisma.$transaction(async (other) => {
          await lockBillingEnrollmentNotices(other, lockKey);
        }),
      );
    });
    await expect(contender).resolves.toBeUndefined();
  });

  test("тестовая база сообщает об отказе, который скрыл фасад, при закрытии", async () => {
    const other = await createMigratedTestDatabase();
    await other.prisma
      .$transaction(async () => {
        await other.prisma.account.count();
      })
      .catch(() => undefined);
    await expect(other.dispose()).rejects.toBeInstanceOf(
      SecondConnectionInTransactionError,
    );
  });

  test("каждое известное нарушение называет существующий файл и номер задачи", () => {
    for (const { issue, through } of knownTransactionViolations) {
      expect(issue).toBeGreaterThan(0);
      expect(existsSync(new URL(`../../${through}`, import.meta.url))).toBe(
        true,
      );
    }
  });
});
