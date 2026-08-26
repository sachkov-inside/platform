import {
  verifiedHumanSignIn,
  verifiedHumanReauthentication,
  verifiedServiceSessionIdentity,
} from "../../../facets/identity-principals/verified-external-identity.js";

interface VerifiedHumanFixture {
  readonly outcome: "verified";
  readonly identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly authenticatedAt: string;
    readonly verifiedEmail: string;
  };
}

interface FailedFixture {
  readonly outcome: "expired" | "invalid" | "unavailable";
}

type HumanSignInFixture = FailedFixture | VerifiedHumanFixture;

interface VerifiedServiceFixture {
  readonly outcome: "verified_service";
  readonly identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly authenticatedAt: string;
  };
}

type ProofFixture = HumanSignInFixture | VerifiedServiceFixture;

interface VerifiedReauthenticationFixture {
  readonly outcome: "verified_reauthentication";
  readonly proof: {
    readonly issuer: string;
    readonly subject: string;
    readonly reauthenticatedAt: string;
    readonly attemptId: string;
    readonly tokenId: string;
  };
}

type AnyProofFixture = ProofFixture | VerifiedReauthenticationFixture;

type ProofFailureCode = "dependency_unavailable" | "invalid_proof";

export type HumanSignInProofResult =
  | {
      readonly ok: true;
      readonly identity: ReturnType<typeof verifiedHumanSignIn>["identity"];
      readonly sessionIdentity: ReturnType<
        typeof verifiedHumanSignIn
      >["sessionIdentity"];
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: ProofFailureCode };
    };

export function createDeterministicExternalIdentityProof(
  fixtures: Readonly<Record<string, AnyProofFixture>>,
): {
  verifyHumanSignIn(fixtureId: string): Promise<HumanSignInProofResult>;
  verifyServiceSession(fixtureId: string): Promise<
    | {
        readonly ok: true;
        readonly identity: ReturnType<typeof verifiedServiceSessionIdentity>;
      }
    | { readonly ok: false; readonly error: { readonly code: ProofFailureCode } }
  >;
  verifyHumanReauthentication(fixtureId: string): Promise<
    | {
        readonly ok: true;
        readonly proof: ReturnType<typeof verifiedHumanReauthentication>;
      }
    | { readonly ok: false; readonly error: { readonly code: ProofFailureCode } }
  >;
} {
  return Object.freeze({
    verifyHumanSignIn(fixtureId: string): Promise<HumanSignInProofResult> {
      const fixture = fixtures[fixtureId];
      if (fixture === undefined) {
        return Promise.resolve({ ok: false, error: { code: "invalid_proof" } });
      }
      if (fixture.outcome !== "verified") {
        return Promise.resolve(fixture.outcome === "unavailable"
          ? { ok: false, error: { code: "dependency_unavailable" } }
          : { ok: false, error: { code: "invalid_proof" } });
      }

      return Promise.resolve({ ok: true, ...verifiedHumanSignIn(fixture.identity) });
    },
    verifyServiceSession(fixtureId) {
      const fixture = fixtures[fixtureId];
      if (fixture?.outcome !== "verified_service") {
        return Promise.resolve(fixture?.outcome === "unavailable"
          ? { ok: false, error: { code: "dependency_unavailable" } }
          : { ok: false, error: { code: "invalid_proof" } });
      }
      return Promise.resolve({
        ok: true,
        identity: verifiedServiceSessionIdentity(fixture.identity),
      });
    },
    verifyHumanReauthentication(fixtureId) {
      const fixture = fixtures[fixtureId];
      if (fixture?.outcome !== "verified_reauthentication") {
        return Promise.resolve(fixture?.outcome === "unavailable"
          ? { ok: false, error: { code: "dependency_unavailable" } }
          : { ok: false, error: { code: "invalid_proof" } });
      }
      return Promise.resolve({
        ok: true,
        proof: verifiedHumanReauthentication(fixture.proof),
      });
    },
  });
}
