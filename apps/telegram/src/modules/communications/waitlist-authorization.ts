import { externalRead } from "../../database/external-reads.js";

export const WAITLIST_AUTHORIZATION = Symbol("WAITLIST_AUTHORIZATION");
export interface WaitlistMember {
  readonly accountRef: string;
  readonly telegramIdentityRef: string;
}
export interface WaitlistQuery {
  readonly actorAccountRef: string;
  readonly intakeId: string;
  readonly recipient?: WaitlistMember;
}
export type WaitlistAuthorizationResult =
  | {
      readonly status: "ok";
      readonly saleOpen: boolean;
      readonly purchaseUrl: string;
      readonly active: number;
      readonly members: readonly WaitlistMember[];
    }
  | { readonly status: "denied" | "unavailable" };
export interface WaitlistAuthorization {
  read(query: WaitlistQuery): Promise<WaitlistAuthorizationResult>;
}
export class DisabledWaitlistAuthorization implements WaitlistAuthorization {
  read(): Promise<WaitlistAuthorizationResult> {
    return Promise.resolve({ status: "unavailable" });
  }
}
export function authorizeWaitlist(
  provider: WaitlistAuthorization,
  query: WaitlistQuery,
) {
  return externalRead(`waitlist:${JSON.stringify(query)}`, () =>
    provider.read(query),
  );
}
