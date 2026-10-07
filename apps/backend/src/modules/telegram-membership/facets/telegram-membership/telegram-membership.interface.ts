import type { AccountId } from "../../../accounts/index.js";
import type {
  MembershipEvidenceAcceptance,
  MembershipEvidenceSource,
} from "../../../account-rights/index.js";

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
      error: {
        readonly code: "invalid_input" | "link_not_found" | "unavailable";
      };
    }>;

export type AccountTelegramLinkState =
  | Readonly<{ kind: "unlinked" }>
  | Readonly<{ expiresAt: string; kind: "linking"; linkRef: string }>
  | Readonly<{ kind: "linked" }>
  | Readonly<{ kind: "conflict"; supportUrl?: string }>
  | Readonly<{ kind: "retryable"; reason: "expired" | "replayed" }>
  | Readonly<{
      kind: "unavailable";
      retry:
        | Readonly<{ kind: "confirm"; linkRef: string }>
        | Readonly<{ kind: "refresh" }>;
    }>
  | Readonly<{
      kind: "recovery-required";
      recovery: Readonly<{ kind: "support"; url?: string }>;
    }>;

export type AccountMembershipState =
  | Readonly<{ kind: "active" }>
  | Readonly<{ kind: "inactive" }>
  | Readonly<{ kind: "notOffered" }>
  | Readonly<{ kind: "stale" }>
  | Readonly<{ kind: "unavailable" }>;

export type AccountTelegramMembershipPresentation = Readonly<{
  link: AccountTelegramLinkState;
  membership: AccountMembershipState;
}>;

export type AccountTelegramMembershipResult =
  | Readonly<{
      ok: true;
      presentation: AccountTelegramMembershipPresentation;
    }>
  | Readonly<{ ok: false; error: { readonly code: "unavailable" } }>;

export interface AcceptTelegramEvidenceCommand {
  readonly deliveryId: string;
  readonly evidence: unknown;
  readonly source: MembershipEvidenceSource;
}

export interface TelegramMembership {
  readAccountPresentation(query: {
    readonly accountId: AccountId;
  }): Promise<AccountTelegramMembershipResult>;
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
  /**
   * Фоновый проход: завершает привязки, которые человек начал в боте, без его возврата на сайт.
   * Бросает исключение при сбое базы; сбой Telegram остаётся состоянием привязки.
   */
  confirmPendingLinks(limit: number): Promise<PendingLinkConfirmationReport>;
}

/** Итог одного фонового прохода: сколько привязок завершено и сколько ещё ждут `/start`. */
export type PendingLinkConfirmationReport = Readonly<{
  linked: number;
  pending: number;
}>;
