/**
 * Production code that still awaits a second pooled connection inside its transaction. When the
 * first refused query of a transaction has the named source file in the frames of the transaction
 * callback, the guard of `transaction-guard.ts` excuses that transaction and the transactions opened
 * inside it. Each entry waits for its issue; the fix removes the entry. Do not add an entry for
 * new code: pass the transaction or move the read before it instead.
 */
export const knownTransactionViolations: readonly {
  readonly issue: number;
  readonly through: string;
}[] = [
  {
    issue: 1017,
    through: "src/modules/billing/facets/billing-notices/billing-notices.ts",
  },
  {
    issue: 1068,
    through:
      "src/modules/membership-entitlements/features/apply-grant-batch/apply-grant-batch.ts",
  },
  {
    issue: 1068,
    through:
      "src/modules/membership-entitlements/features/preview-grant-batch/preview-grant-batch.ts",
  },
  {
    issue: 1069,
    through:
      "src/modules/billing/facets/billing-operations/billing-operations.ts",
  },
  {
    issue: 1071,
    through: "src/modules/billing/facets/billing-payments/billing-payments.ts",
  },
  {
    issue: 1072,
    through:
      "src/modules/billing/facets/tribute-convergence/tribute-convergence.ts",
  },
  {
    issue: 1072,
    through:
      "src/modules/membership-entitlements/facets/tribute-sources/tribute-sources.ts",
  },
  {
    issue: 1073,
    through:
      "src/modules/billing/facets/subscription-activation/subscription-activation.ts",
  },
  {
    issue: 1077,
    through:
      "src/modules/telegram-membership/features/authorize-community-dispatch/authorize-community-dispatch.ts",
  },
];
