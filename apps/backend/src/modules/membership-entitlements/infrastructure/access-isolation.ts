import { Prisma } from "../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrisma } from "./prisma.js";

export async function setAccessSnapshotIsolation(
  prisma: MembershipEntitlementsPrisma,
): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`set transaction isolation level repeatable read`,
  );
}
