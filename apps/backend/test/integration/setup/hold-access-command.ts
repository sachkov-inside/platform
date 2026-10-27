import { expect } from "vitest";
import {
  lockAccountAccess,
  lockAccountEntitlementChanges,
} from "../../../src/infrastructure/prisma/index.js";
import type { TestDatabase } from "./test-database.js";

/** Hold an existing command lock until two public calls have actually reached PostgreSQL. */
export async function concurrentAccessCommands<Result>(
  db: TestDatabase,
  key: { accountId: string } | { scope: string },
  invoke: () => Promise<Result>,
) {
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = db.prisma.$transaction(async (tx) => {
    if ("accountId" in key)
      await lockAccountEntitlementChanges(tx, key.accountId);
    else await lockAccountAccess(tx, key.scope);
    locked();
    await gate;
  });
  await acquired;
  const operations = Promise.all([invoke(), invoke()]);
  try {
    await expect
      .poll(async () => {
        const rows = await db.prisma.$queryRaw<
          { count: bigint }[]
        >`select count(*) from pg_stat_activity where datname = current_database() and wait_event = 'advisory'`;
        return Number(rows[0]?.count);
      })
      .toBeGreaterThanOrEqual(2);
  } finally {
    release();
  }
  await holder;
  return operations;
}
