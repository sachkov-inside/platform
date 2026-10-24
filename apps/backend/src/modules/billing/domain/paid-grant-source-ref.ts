/** Stable AccountRights paid-source identity shared by fulfillment and diagnostics. */
export function paidGrantSourceRef(
  purchaseRef: string,
  capability: string,
): string {
  return `${purchaseRef}:${capability}`;
}
