import { Prisma } from "../../../infrastructure/prisma/index.js";
import type { AccountRightsPrisma } from "./prisma.js";

export async function setAccessSnapshotIsolation(
  prisma: AccountRightsPrisma,
): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`set transaction isolation level repeatable read`,
  );
}
