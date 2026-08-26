const verifiedLogtoIdentity = Symbol("verified-logto-identity");

interface LogtoIdentityKey {
  readonly issuer: string;
  readonly subject: string;
  readonly [verifiedLogtoIdentity]: true;
}

export interface VerifiedAccountSignIn extends LogtoIdentityKey {
  readonly type: "account_sign_in";
  readonly verifiedEmail: string;
}

export interface VerifiedAccountIdentity extends LogtoIdentityKey {
  readonly type: "account_identity";
}

export function verifiedAccountSignIn(value: {
  readonly issuer: string;
  readonly subject: string;
  readonly verifiedEmail: string;
}): {
  readonly identity: VerifiedAccountSignIn;
  readonly accountIdentity: VerifiedAccountIdentity;
} {
  return {
    identity: Object.freeze({
      ...value,
      type: "account_sign_in" as const,
      [verifiedLogtoIdentity]: true as const,
    }),
    accountIdentity: verifiedAccountIdentity(value),
  };
}

export function verifiedAccountIdentity(value: {
  readonly issuer: string;
  readonly subject: string;
}): VerifiedAccountIdentity {
  return Object.freeze({
    issuer: value.issuer,
    subject: value.subject,
    type: "account_identity" as const,
    [verifiedLogtoIdentity]: true as const,
  });
}
