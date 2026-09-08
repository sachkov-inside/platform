import { z } from "zod";
import { Prisma } from "../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrisma } from "./prisma.js";

export async function lockAccess(
  prisma: MembershipEntitlementsPrisma,
  key: string,
): Promise<void> {
  z.array(z.object({ lock: z.string() })).parse(
    await prisma.$queryRaw(Prisma.sql`
    select pg_advisory_xact_lock(hashtextextended(${`account-access:${key}`}, 0::bigint))::text as lock
  `),
  );
}

export async function setAccessSnapshotIsolation(
  prisma: MembershipEntitlementsPrisma,
): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`set transaction isolation level repeatable read`,
  );
}
