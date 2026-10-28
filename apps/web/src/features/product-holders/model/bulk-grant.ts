import {
  PRODUCT_HOLDERS_ACCOUNT_LIMIT,
  type HolderAccess,
} from "./product-holders";

/**
 * «Выдать продукт» нескольким людям (до 50) одной причиной. Это не новая команда: браузер по
 * очереди, не больше двух запросов сразу, вызывает единственную выдачу Product Access. Её правила,
 * идемпотентность и итог принадлежат Product Access; здесь только порядок вызовов и ссылки.
 */
export const BULK_GRANT_LIMIT = PRODUCT_HOLDERS_ACCOUNT_LIMIT;
export const BULK_GRANT_CONCURRENCY = 2;

/** The input of the single manual issue, the shape of `issueProductAccessOperation`. */
export interface BulkGrantIssueInput {
  readonly accountId: string;
  readonly productId: string;
  readonly sourceRef: string;
  readonly reason: string;
}

/** The part of the issue result the loop reads; the operation's own result satisfies it. */
export type BulkGrantIssueResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly outcome: "issued" | "already_active" | "revoked";
      };
    }
  | { readonly ok: false; readonly code: string };

/** One manual issue for one person. The page supplies it; the loop never builds requests itself. */
export type BulkGrantSend = (
  input: BulkGrantIssueInput,
) => Promise<BulkGrantIssueResult>;

export type BulkGrantOutcome =
  "issued" | "already_active" | "revoked" | "error";

export interface BulkGrantRowResult {
  readonly accountId: string;
  readonly outcome: BulkGrantOutcome;
  /** The failure code of an `error` row. */
  readonly code?: string;
}

/**
 * A batch fixes its id, Product, reason and people until it completes. A retry repeats the same
 * `sourceRef` and reason for each person, so Product Access recognises the earlier attempt
 * instead of recording a second source or refusing a changed one.
 */
export interface BulkGrantBatch {
  readonly batchId: string;
  readonly productId: string;
  readonly reason: string;
  readonly accountIds: readonly string[];
}

export function createBulkGrantBatch(input: {
  readonly batchId: string;
  readonly productId: string;
  readonly reason: string;
  readonly accountIds: readonly string[];
}): BulkGrantBatch {
  const accountIds = [...new Set(input.accountIds)];
  if (accountIds.length === 0)
    throw new RangeError("A bulk grant needs at least one person");
  if (accountIds.length > BULK_GRANT_LIMIT)
    throw new RangeError(
      `A bulk grant takes at most ${String(BULK_GRANT_LIMIT)} people`,
    );
  const reason = input.reason.trim();
  if (reason === "") throw new RangeError("A bulk grant needs a reason");
  return {
    batchId: input.batchId,
    productId: input.productId,
    reason,
    accountIds,
  };
}

/** The repeatable reference of one person's issue within a batch. */
export function bulkGrantSourceRef(batchId: string, accountId: string): string {
  return `admin-bulk:${batchId}:${accountId}`;
}

/**
 * Sends the issue for `accountIds` of the batch (all of them, or the failed ones on retry), at
 * most `BULK_GRANT_CONCURRENCY` at once, and reports each person as soon as their answer comes.
 * A thrown send is a failed row; the loop goes on with the others.
 */
export async function runBulkGrant(
  batch: BulkGrantBatch,
  accountIds: readonly string[],
  send: BulkGrantSend,
  onResult?: (result: BulkGrantRowResult) => void,
): Promise<readonly BulkGrantRowResult[]> {
  const members = new Set(batch.accountIds);
  const queue = [...new Set(accountIds)];
  for (const accountId of queue)
    if (!members.has(accountId))
      throw new RangeError("A retry may only repeat people of its batch");
  const results = new Map<string, BulkGrantRowResult>();
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const accountId = queue[next];
      next += 1;
      if (accountId === undefined) return;
      const result = await issueOne(batch, accountId, send);
      results.set(accountId, result);
      onResult?.(result);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(BULK_GRANT_CONCURRENCY, queue.length) },
      worker,
    ),
  );
  return queue.flatMap((accountId) => {
    const result = results.get(accountId);
    return result === undefined ? [] : [result];
  });
}

async function issueOne(
  batch: BulkGrantBatch,
  accountId: string,
  send: BulkGrantSend,
): Promise<BulkGrantRowResult> {
  try {
    const result = await send({
      accountId,
      productId: batch.productId,
      sourceRef: bulkGrantSourceRef(batch.batchId, accountId),
      reason: batch.reason,
    });
    return result.ok
      ? { accountId, outcome: result.value.outcome }
      : { accountId, outcome: "error", code: result.code };
  } catch {
    return { accountId, outcome: "error", code: "unavailable" };
  }
}

/** The people a retry sends again: only the failed rows. */
export function failedAccountIds(
  results: ReadonlyMap<string, BulkGrantRowResult>,
): readonly string[] {
  return [...results.values()]
    .filter((result) => result.outcome === "error")
    .map((result) => result.accountId);
}

/** What the pre-check read already knows: such a person is not sent, the answer is known. */
export function precheckOutcome(
  access: HolderAccess,
): "already_active" | "revoked" {
  return access === "active" ? "already_active" : "revoked";
}

export const bulkGrantOutcomeLabels: Record<
  Exclude<BulkGrantOutcome, "error">,
  string
> = {
  issued: "Выдан",
  already_active: "Уже есть доступ",
  revoked: "Доступ отозван, восстановите в карточке человека",
};

const errorTexts: Readonly<Record<string, string>> = {
  unauthorized: "Сессия закончилась. Войдите снова и повторите.",
  forbidden: "Нет права выдавать продукты.",
  not_found: "Человек или продукт не найден.",
  operation_conflict: "Эта выдача уже записана с другой причиной.",
};

/** The reason of a failed row in words; the row keeps a retry. */
export function bulkGrantErrorText(code: string | undefined): string {
  return (
    (code === undefined ? undefined : errorTexts[code]) ??
    "Не удалось выдать. Повторите позже."
  );
}
