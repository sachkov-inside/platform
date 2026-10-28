import { hasText } from "../../../../infrastructure/contracts/text.js";
import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { billingContactProtection } from "../../infrastructure/billing-contact-protection.js";
import { fingerprintEmail } from "../../shared/account-input.js";

const defaultPageSize = 200;

export interface BillingContactFingerprintBackfillResult {
  readonly scanned: number;
  readonly written: number;
  /** Rows a confirm changed after the read; that confirm wrote its own fingerprint. */
  readonly skippedConcurrent: number;
  /** Rows whose address cannot be opened or normalized; they stay unsearchable. */
  readonly unreadable: number;
}

export interface BillingContactFingerprintBackfillInput {
  readonly prisma: AccountsPrismaClient;
  readonly encryptionKey: string;
  readonly emailFingerprintKey: string;
  readonly pageSize?: number;
}

/**
 * Release operation: fingerprints each verified Billing Contact whose fingerprint does not belong
 * to its current revision. Each write applies only to the revision it read, so a concurrent confirm
 * wins; a rerun scans only what is still missing. The result carries counts, never an address.
 */
export async function backfillBillingContactFingerprints({
  prisma,
  encryptionKey,
  emailFingerprintKey,
  pageSize = defaultPageSize,
}: BillingContactFingerprintBackfillInput): Promise<BillingContactFingerprintBackfillResult> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new RangeError("pageSize must be a positive integer");
  const protection = billingContactProtection(encryptionKey);
  const revision = prisma.billingContact.fields.revision;
  let scanned = 0;
  let written = 0;
  let skippedConcurrent = 0;
  let unreadable = 0;
  let after: string | undefined;
  for (;;) {
    const page = await prisma.billingContact.findMany({
      where: {
        revision: { gt: 0 },
        OR: [
          { emailFingerprintRevision: null },
          { emailFingerprintRevision: { not: { equals: revision } } },
        ],
        ...(after === undefined ? {} : { accountId: { gt: after } }),
      },
      orderBy: { accountId: "asc" },
      take: pageSize,
      select: { accountId: true, revision: true, emailCiphertext: true },
    });
    for (const row of page) {
      scanned += 1;
      const fingerprint = readFingerprint(
        () =>
          hasText(row.emailCiphertext)
            ? protection.open(row.accountId, row.emailCiphertext)
            : undefined,
        emailFingerprintKey,
      );
      if (fingerprint === undefined) {
        unreadable += 1;
        continue;
      }
      const { count } = await prisma.billingContact.updateMany({
        where: { accountId: row.accountId, revision: row.revision },
        data: {
          emailFingerprint: fingerprint,
          emailFingerprintRevision: row.revision,
        },
      });
      if (count === 1) written += 1;
      else skippedConcurrent += 1;
    }
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize)
      return { scanned, written, skippedConcurrent, unreadable };
    after = last.accountId;
  }
}

function readFingerprint(
  open: () => string | undefined,
  key: string,
): string | undefined {
  let email: string | undefined;
  try {
    email = open();
  } catch {
    // Not a dependency failure: a sealed address this key cannot open is counted as unreadable.
    return undefined;
  }
  return email === undefined ? undefined : fingerprintEmail(email, key);
}
