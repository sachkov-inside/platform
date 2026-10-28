import { Prisma } from "../../../infrastructure/prisma/index.js";

/**
 * Whether the row `account` of `accounts.accounts` is a person of the owner's directory (#1721):
 * a Sign-in Email, a verified Billing Contact, or one of `linkedAccountIds`, the current Telegram
 * links that Telegram Membership owns. The people list and the Overview's new people (#1719) both
 * read it, so the two numbers agree.
 */
export function isDirectoryPerson(
  linkedAccountIds: readonly string[],
): Prisma.Sql {
  return Prisma.sql`(
    account.email_fingerprint is not null
    or exists (
      select 1 from accounts.billing_contacts verified
      where verified.account_id = account.id
        and verified.verified_at is not null
        and verified.email_ciphertext is not null
    )
    or account.id = any(${linkedAccountIds}::uuid[])
  )`;
}
