import {
  Prisma,
  type TelegramMembershipPrisma,
} from "../../../infrastructure/prisma/index.js";

/**
 * Serialises community work under one key, so a second worker cannot open a competing
 * desired state, a duplicate delivery, or a second answer to the same authorization.
 */
export async function lockCommunityWork(
  transaction: TelegramMembershipPrisma,
  key: string,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`telegram-community:${key}`}, 0::bigint)
    )
  `);
}
