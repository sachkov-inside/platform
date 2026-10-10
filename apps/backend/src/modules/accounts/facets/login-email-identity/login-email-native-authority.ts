import type { VerifiedAccountIdentity } from "../accounts/verified-logto-identity.js";
import type {
  NativeLoginEmailCandidate,
  NativeLoginEmailCommit,
  NativeLoginEmailInteraction,
} from "../../features/login-email-identity/login-email-policy.js";

/**
 * Trusted native-interaction boundary, not the public Experience API or a client JSON envelope.
 * An implementation must authenticate the existing private browser record and bind the exact
 * owner/interaction/intent before returning evidence. State + PKCE alone cannot satisfy this port.
 * No implementation is installed by AccountsModule yet; every write then fails closed.
 * These are our adapter capabilities, NOT claims that upstream exposes these receipt APIs.
 */
export interface LoginEmailNativeAuthority {
  readInteraction(command: {
    readonly identity: VerifiedAccountIdentity;
    readonly nativeContext: unknown;
  }): Promise<NativeLoginEmailInteraction | undefined>;
  readVerifiedCandidate(command: {
    readonly identity: VerifiedAccountIdentity;
    readonly intentRef: string;
    readonly nativeContext: unknown;
  }): Promise<NativeLoginEmailCandidate | undefined>;
  /** Undefined means unknown (including a lost response); never a definitive abort. */
  readCommittedEmail(command: {
    readonly identity: VerifiedAccountIdentity;
    readonly intentRef: string;
    readonly nativeContext: unknown;
  }): Promise<NativeLoginEmailCommit | undefined>;
}
