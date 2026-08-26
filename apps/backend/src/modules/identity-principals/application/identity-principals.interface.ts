import type {
  VerifiedHumanSessionIdentity,
  VerifiedHumanSignIn,
  VerifiedHumanReauthentication,
  VerifiedServiceSessionIdentity,
  VerifiedSessionIdentity,
} from "./verified-external-identity.js";

export type PrincipalKind = "human" | "service";

export type PlatformPermission =
  | "identity:admin"
  | "materials:author"
  | "materials:publish";

export interface TrustedSubject {
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly sessionRef: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
  readonly permissions: readonly PlatformPermission[];
}

type ErrorCode<C extends string> = { readonly code: C };
export type InternalIdentityError = {
  readonly code: "internal_error";
  readonly correlationId: string;
};

export type HumanSessionEstablishmentError =
  | ErrorCode<
      | "idempotency_key_reused"
      | "identity_conflict"
      | "invalid_input"
      | "principal_disabled"
    >
  | InternalIdentityError;

export type ServiceSessionEstablishmentError =
  | ErrorCode<
      | "idempotency_key_reused"
      | "identity_not_found"
      | "invalid_input"
      | "principal_disabled"
    >
  | InternalIdentityError;

export type ResolveSubjectError =
  | ErrorCode<
      | "identity_mismatch"
      | "invalid_input"
      | "principal_disabled"
      | "session_ended"
      | "session_expired"
      | "session_not_found"
    >
  | InternalIdentityError;

export type ReauthenticationError =
  | ErrorCode<
      | "idempotency_key_reused"
      | "identity_mismatch"
      | "invalid_input"
      | "principal_disabled"
      | "reauthentication_required"
      | "session_ended"
      | "session_expired"
      | "session_not_found"
    >
  | InternalIdentityError;

export type BeginReauthenticationError =
  | ErrorCode<
      | "idempotency_key_reused"
      | "invalid_input"
      | "principal_disabled"
      | "session_ended"
      | "session_expired"
      | "session_not_found"
    >
  | InternalIdentityError;

export type PermissionError =
  | ErrorCode<"identity_not_found" | "invalid_input" | "principal_disabled">
  | InternalIdentityError;

export type EndSessionError =
  | ErrorCode<
      | "idempotency_key_reused"
      | "identity_mismatch"
      | "invalid_input"
      | "session_not_found"
    >
  | InternalIdentityError;

export type IdentityError =
  | HumanSessionEstablishmentError
  | ServiceSessionEstablishmentError
  | ResolveSubjectError
  | ReauthenticationError
  | PermissionError;

export type HumanSessionEstablishmentResult =
  | { readonly ok: true; readonly subject: TrustedSubject }
  | { readonly ok: false; readonly error: HumanSessionEstablishmentError };

export type ServiceSessionEstablishmentResult =
  | { readonly ok: true; readonly subject: TrustedSubject }
  | { readonly ok: false; readonly error: ServiceSessionEstablishmentError };

export type ResolveSubjectResult =
  | { readonly ok: true; readonly subject: TrustedSubject }
  | { readonly ok: false; readonly error: ResolveSubjectError };

export type EndSessionResult =
  | { readonly ok: true; readonly ended: true }
  | { readonly ok: false; readonly error: EndSessionError };

export type PermissionDecision =
  | { readonly ok: true; readonly allowed: boolean }
  | { readonly ok: false; readonly error: PermissionError };

export type BeginReauthenticationResult =
  | {
      readonly ok: true;
      readonly attemptId: string;
      readonly expiresAt: string;
    }
  | { readonly ok: false; readonly error: BeginReauthenticationError };

export type CompleteReauthenticationResult =
  | { readonly ok: true; readonly subject: TrustedSubject }
  | { readonly ok: false; readonly error: ReauthenticationError };

export interface IdentityPrincipals {
  establishHumanSession(command: {
    readonly identity: VerifiedHumanSignIn;
    readonly idempotencyKey: string;
  }): Promise<HumanSessionEstablishmentResult>;

  establishServiceSession(command: {
    readonly identity: VerifiedServiceSessionIdentity;
    readonly idempotencyKey: string;
  }): Promise<ServiceSessionEstablishmentResult>;

  resolveSubject(query: {
    readonly identity: VerifiedSessionIdentity;
    readonly sessionRef: string;
  }): Promise<ResolveSubjectResult>;

  beginHumanReauthentication(command: {
    readonly identity: VerifiedHumanSessionIdentity;
    readonly idempotencyKey: string;
    readonly sessionRef: string;
  }): Promise<BeginReauthenticationResult>;

  completeHumanReauthentication(command: {
    readonly proof: VerifiedHumanReauthentication;
    readonly idempotencyKey: string;
    readonly sessionRef: string;
  }): Promise<CompleteReauthenticationResult>;

  endSession(command: {
    readonly identity: VerifiedSessionIdentity;
    readonly idempotencyKey: string;
    readonly sessionRef: string;
  }): Promise<EndSessionResult>;

  checkPermission(query: {
    readonly principalId: string;
    readonly permission: PlatformPermission;
  }): Promise<PermissionDecision>;
}

export type {
  VerifiedHumanSessionIdentity,
  VerifiedHumanSignIn,
  VerifiedHumanReauthentication,
  VerifiedServiceSessionIdentity,
  VerifiedSessionIdentity,
};
