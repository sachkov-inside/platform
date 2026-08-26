const verifiedIdentity = Symbol("verified-external-identity");

interface ExternalIdentityKey {
  readonly issuer: string;
  readonly subject: string;
  readonly [verifiedIdentity]: true;
}

export interface VerifiedHumanSignIn extends ExternalIdentityKey {
  readonly type: "human_sign_in";
  readonly authenticatedAt: string;
  readonly verifiedEmail: string;
}

export interface VerifiedHumanSessionIdentity extends ExternalIdentityKey {
  readonly type: "human_session";
}

export interface VerifiedServiceSessionIdentity extends ExternalIdentityKey {
  readonly type: "service_session";
  readonly authenticatedAt: string;
}

export interface VerifiedHumanReauthentication extends ExternalIdentityKey {
  readonly type: "human_reauthentication";
  readonly reauthenticatedAt: string;
  readonly attemptId: string;
  readonly tokenId: string;
}

export type VerifiedSessionIdentity =
  | VerifiedHumanSessionIdentity
  | VerifiedServiceSessionIdentity;

export function verifiedHumanSignIn(value: {
  readonly issuer: string;
  readonly subject: string;
  readonly authenticatedAt: string;
  readonly verifiedEmail: string;
}): {
  readonly identity: VerifiedHumanSignIn;
  readonly sessionIdentity: VerifiedHumanSessionIdentity;
} {
  return {
    identity: Object.freeze({
      ...value,
      type: "human_sign_in" as const,
      [verifiedIdentity]: true as const,
    }),
    sessionIdentity: Object.freeze({
      issuer: value.issuer,
      subject: value.subject,
      type: "human_session" as const,
      [verifiedIdentity]: true as const,
    }),
  };
}

export function verifiedServiceSessionIdentity(value: {
  readonly issuer: string;
  readonly subject: string;
  readonly authenticatedAt: string;
}): VerifiedServiceSessionIdentity {
  return Object.freeze({
    ...value,
    type: "service_session" as const,
    [verifiedIdentity]: true as const,
  });
}

export function verifiedHumanSessionIdentity(value: {
  readonly issuer: string;
  readonly subject: string;
}): VerifiedHumanSessionIdentity {
  return Object.freeze({
    ...value,
    type: "human_session" as const,
    [verifiedIdentity]: true as const,
  });
}

export function verifiedHumanReauthentication(value: {
  readonly issuer: string;
  readonly subject: string;
  readonly reauthenticatedAt: string;
  readonly attemptId: string;
  readonly tokenId: string;
}): VerifiedHumanReauthentication {
  return Object.freeze({
    ...value,
    type: "human_reauthentication" as const,
    [verifiedIdentity]: true as const,
  });
}
