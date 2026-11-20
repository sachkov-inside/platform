/** Owns the last known identity for the lifetime of one mobile navigation shell. */
export class MobileNavigationIdentity {
  private lastKnownAccountId: string | null | undefined;

  /** An unavailable status supplies no identity. A resolved guest supplies null. */
  accept(
    accountId: string | null | undefined,
    resetNavigation: () => void,
  ): void {
    if (accountId === undefined) return;
    if (
      this.lastKnownAccountId !== undefined &&
      this.lastKnownAccountId !== accountId
    )
      resetNavigation();
    this.lastKnownAccountId = accountId;
  }
}
