/**
 * Confirmed links between an Account and an external Telegram identity. Telegram Membership owns
 * their lifecycle and implements this port under `RECIPIENT_LINKS`.
 */
export interface RecipientLinks {
  /** Exact current verified identity only; historical links and usernames are never recipients. */
  findCurrentByIdentity(identityRef: string): Promise<
    | { readonly ok: false }
    | { readonly ok: true; readonly state: "ambiguous" }
    | { readonly ok: true; readonly state: "not_found" }
    | {
        readonly ok: true;
        readonly state: "found";
        readonly recipient: {
          readonly accountId: string;
          readonly accountRef: string;
          readonly identityRef: string;
          readonly linkRef: string;
          readonly linkRevision: number;
        };
      }
  >;
  /** The current binding, or the one at `revision`; a null identity is an unlink tombstone. */
  readBinding(query: { readonly accountId: string; readonly revision?: number }): Promise<
    | { readonly ok: false }
    | {
        readonly ok: true;
        readonly binding: {
          readonly linkRef: string;
          readonly linkRevision: number;
          readonly accountRef: string | null;
          readonly telegramIdentityRef: string | null;
        } | null;
      }
  >;
}

export const RECIPIENT_LINKS = Symbol("RECIPIENT_LINKS");
