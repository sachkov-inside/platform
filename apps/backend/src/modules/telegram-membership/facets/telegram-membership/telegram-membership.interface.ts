import type { AccountId } from "../../../accounts/index.js";
import type {
  MembershipEvidenceAcceptance,
  MembershipEvidenceSource,
} from "../../../membership-entitlements/index.js";

export type TelegramLinkStatus =
  | "conflict"
  | "expired"
  | "linked"
  | "pending"
  | "recovery-required"
  | "replayed"
  | "unavailable";

export type TelegramLinkState = Readonly<{
  deepLink?: string;
  expiresAt: string;
  linkRef: string;
  status: TelegramLinkStatus;
}>;

export type TelegramLinkResult =
  | Readonly<{ ok: true; state: TelegramLinkState }>
  | Readonly<{
      ok: false;
      error: { readonly code: "invalid_input" | "link_not_found" };
    }>;

export interface AcceptTelegramEvidenceCommand {
  readonly deliveryId: string;
  readonly evidence: unknown;
  readonly source: MembershipEvidenceSource;
}

export interface TelegramMembership {
  beginLink(command: {
    readonly accountId: AccountId;
  }): Promise<TelegramLinkResult>;
  confirmLink(command: {
    readonly accountId: AccountId;
    readonly linkRef: string;
  }): Promise<TelegramLinkResult>;
  acceptEvidence(
    command: AcceptTelegramEvidenceCommand,
  ): Promise<MembershipEvidenceAcceptance>;
}
