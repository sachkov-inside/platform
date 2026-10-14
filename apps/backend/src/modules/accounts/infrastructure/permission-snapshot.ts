import {
  Prisma,
  type AccountsPrisma,
} from "../../../infrastructure/prisma/index.js";

/** The Account-set permission decision observes existence and grants in one snapshot. */
export async function setPermissionSnapshotIsolation(
  transaction: AccountsPrisma,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`set transaction isolation level repeatable read`,
  );
}
