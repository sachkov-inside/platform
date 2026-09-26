import { Prisma } from "./generated/client.js";

interface AdvisoryLockTransaction {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

/**
 * The single source of transaction advisory lock keys. Two operations exclude each other only when
 * they call the same function here; `scripts/check-backend-architecture.mjs` rejects a lock written
 * anywhere else, so a key cannot drift between the Modules that share it.
 */
async function lockTransactionKey(
  transaction: AdvisoryLockTransaction,
  key: string,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    select pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))
  `);
}

export async function lockAccountEntitlementChanges(
  transaction: AdvisoryLockTransaction,
  accountId: string,
): Promise<void> {
  await lockTransactionKey(transaction, `account-entitlement:${accountId}`);
}

/**
 * Serializes every change of what a Material references with the cleanup that trusts it: Save,
 * draft deletion, Guide order and Workshop Cases against orphan Asset cleanup and Video deletion.
 * Keys are taken in one order, so callers that lock several Materials cannot deadlock each other.
 */
export async function lockMaterialReferenceChanges(
  transaction: AdvisoryLockTransaction,
  materialIds: readonly string[],
): Promise<void> {
  const orderedIds = [...new Set(materialIds)].sort();
  for (const materialId of orderedIds) {
    await lockTransactionKey(transaction, `material-references:${materialId}`);
  }
}

/** Serializes a cover change of one Material, Topic or Series with its orphan cleanup. */
export async function lockContentCoverOwner(
  transaction: AdvisoryLockTransaction,
  owner: Readonly<{ id: string; kind: "material" | "series" | "topic" }>,
): Promise<void> {
  await lockTransactionKey(transaction, `${owner.kind}:${owner.id}`);
}

/** Serializes slug allocation, so two first publications cannot take the same slug. */
export async function lockMaterialSlugAllocation(
  transaction: AdvisoryLockTransaction,
): Promise<void> {
  await lockTransactionKey(transaction, "materials:slug-allocation");
}

/** Same key as the durable Telegram binding trigger; holds a verified binding through commit. */
export async function lockTelegramAccountBinding(
  transaction: AdvisoryLockTransaction,
  accountId: string,
): Promise<void> {
  await lockTransactionKey(transaction, `telegram-link-state:${accountId}`);
}

/** Serializes Telegram link attempts of one Account: begin, confirmation and sign-in. */
export async function lockTelegramMembershipLink(
  transaction: AdvisoryLockTransaction,
  accountId: string,
): Promise<void> {
  await lockTransactionKey(
    transaction,
    `telegram-membership-link:${accountId}`,
  );
}

/** Serializes Telegram community work under one key: desired state, delivery or authorization. */
export async function lockTelegramCommunityWork(
  transaction: AdvisoryLockTransaction,
  key: string,
): Promise<void> {
  await lockTransactionKey(transaction, `telegram-community:${key}`);
}

type AccountRecordKey =
  | `billing-account:${string}`
  | `billing-recipient:${string}`
  | `email:${string}`
  | `legal-acceptance:${string}`
  | `logto:${string}`
  | `telegram:${string}`;

/**
 * Serializes Account establishment and Account-owned records by identity, contact and acceptance.
 * Keys are taken in one order, so callers that lock several records cannot deadlock each other.
 */
export async function lockAccountRecords(
  transaction: AdvisoryLockTransaction,
  keys: readonly AccountRecordKey[],
): Promise<void> {
  for (const key of [...keys].sort()) {
    await lockTransactionKey(transaction, key);
  }
}

/** Serializes one access decision scope: an enrollment source, a batch, a rule or an operation. */
export async function lockAccountAccess(
  transaction: AdvisoryLockTransaction,
  key: string,
): Promise<void> {
  await lockTransactionKey(transaction, `account-access:${key}`);
}

/** Catalog edits and first-payment reservations share one short lock; no provider I/O under it. */
export async function lockBillingPricing(
  transaction: AdvisoryLockTransaction,
): Promise<void> {
  await lockTransactionKey(transaction, "billing:pricing");
}

/** Worker dispatch, cancel, change and payment-method decisions serialize on one subscription. */
export async function lockBillingSubscription(
  transaction: AdvisoryLockTransaction,
  subscriptionRef: string,
): Promise<void> {
  await lockTransactionKey(
    transaction,
    `billing:subscription:${subscriptionRef}`,
  );
}

/** Refund decisions and their execution serialize on one confirmed payment; no provider I/O under it. */
export async function lockBillingPurchase(
  transaction: AdvisoryLockTransaction,
  purchaseRef: string,
): Promise<void> {
  await lockTransactionKey(transaction, `billing:purchase:${purchaseRef}`);
}

/** Serializes a Profile avatar change of one Account with the orphan cleanup that trusts it. */
export async function lockProfileAvatarOwner(
  transaction: AdvisoryLockTransaction,
  accountId: string,
): Promise<void> {
  await lockTransactionKey(transaction, `profile-avatar:${accountId}`);
}

/** Serializes one notification scope: a delivery, an audience, preferences or the quarantine. */
export async function lockNotification(
  transaction: AdvisoryLockTransaction,
  key: string,
): Promise<void> {
  await lockTransactionKey(transaction, `notifications:${key}`);
}

/** Serializes retries of one reading command of an Account. */
export async function lockReadingCommand(
  transaction: AdvisoryLockTransaction,
  accountId: string,
  commandId: string,
): Promise<void> {
  await lockTransactionKey(
    transaction,
    `reading-command:${accountId}:${commandId}`,
  );
}

/** Serializes reading state changes of one Account and Material. */
export async function lockReadingPair(
  transaction: AdvisoryLockTransaction,
  accountId: string,
  materialId: string,
): Promise<void> {
  await lockTransactionKey(
    transaction,
    `reading-pair:${accountId}:${materialId}`,
  );
}
