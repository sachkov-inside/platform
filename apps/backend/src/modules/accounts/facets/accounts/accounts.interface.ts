import type {
  VerifiedAccountIdentity,
  VerifiedAccountSignIn,
} from "./verified-logto-identity.js";

export type PlatformPermission = "materials:manage";

export interface AuthenticatedAccount {
  readonly accountId: string;
}

type ErrorCode<Code extends string> = { readonly code: Code };
export type InternalAccountError = {
  readonly code: "internal_error";
  readonly correlationId: string;
};

export type EstablishAccountError =
  | ErrorCode<"identity_conflict" | "invalid_input">
  | InternalAccountError;

export type ResolveAccountError =
  | ErrorCode<"account_not_found" | "invalid_input">
  | InternalAccountError;

export type PermissionError =
  | ErrorCode<"account_not_found" | "invalid_input">
  | InternalAccountError;

export type AccountError =
  | EstablishAccountError
  | ResolveAccountError
  | PermissionError;

export type EstablishAccountResult =
  | { readonly ok: true; readonly account: AuthenticatedAccount }
  | { readonly ok: false; readonly error: EstablishAccountError };

export type ResolveAccountResult =
  | { readonly ok: true; readonly account: AuthenticatedAccount }
  | { readonly ok: false; readonly error: ResolveAccountError };

export type PermissionDecision =
  | { readonly ok: true; readonly allowed: boolean }
  | { readonly ok: false; readonly error: PermissionError };

export interface Accounts {
  establishAccount(command: {
    readonly identity: VerifiedAccountSignIn;
  }): Promise<EstablishAccountResult>;

  resolveAccount(query: {
    readonly identity: VerifiedAccountIdentity;
  }): Promise<ResolveAccountResult>;

  checkPermission(query: {
    readonly accountId: string;
    readonly permission: PlatformPermission;
  }): Promise<PermissionDecision>;
}

export type { VerifiedAccountIdentity, VerifiedAccountSignIn };
