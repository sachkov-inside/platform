/** Owns the last known identity for the lifetime of one mobile navigation shell. */
export class MobileNavigationIdentity {
  private account: string | null | undefined;

  /** An unavailable status supplies no identity. A resolved guest supplies null. */
  accept(
    account: string | null | undefined,
    resetNavigation: () => void,
  ): void {
    if (account === undefined) return;
    if (this.account !== undefined && this.account !== account)
      resetNavigation();
    this.account = account;
  }
}
