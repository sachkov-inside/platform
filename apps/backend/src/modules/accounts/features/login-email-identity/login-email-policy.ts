export interface NativeLoginEmailInteraction {
  readonly ownerIdentity: { readonly issuer: string; readonly subject: string };
  readonly interactionRef: string;
  /** Derived by the trusted adapter from the EXISTING private native browser record. */
  readonly browserBindingDigest: string;
}

export interface NativeLoginEmailCandidate extends NativeLoginEmailInteraction {
  readonly intentRef: string;
  readonly email: string;
  readonly verificationRef: string;
  readonly telegramProof: {
    readonly subjectRef: string;
    readonly requestRef: string;
    readonly approvedAt: string;
  };
}

export interface NativeLoginEmailCommit extends NativeLoginEmailInteraction {
  readonly intentRef: string;
  readonly state: "attached";
  readonly email: string;
  readonly verificationRef: string;
}

export type LoginEmailState =
  | "pending"
  | "reserved"
  | "finalized"
  | "superseded"
  | "reconciliation_required";

export interface LoginEmailIntent extends NativeLoginEmailInteraction {
  readonly intentRef: string;
  readonly accountId: string;
  readonly state: LoginEmailState;
  readonly candidateFingerprint: string | null;
  readonly verificationRef: string | null;
  readonly telegramSubjectRef: string;
  readonly expiresAt: Date;
}

export function matchesLoginEmailInteraction(
  intent: NativeLoginEmailInteraction,
  proof: NativeLoginEmailInteraction,
): boolean {
  return (
    intent.ownerIdentity.issuer === proof.ownerIdentity.issuer &&
    intent.ownerIdentity.subject === proof.ownerIdentity.subject &&
    intent.interactionRef === proof.interactionRef &&
    intent.browserBindingDigest === proof.browserBindingDigest
  );
}

export function canReserveLoginEmail(
  intent: LoginEmailIntent,
  proof: NativeLoginEmailCandidate,
  fingerprint: string,
  now: Date,
): boolean {
  const approvedAt = Date.parse(proof.telegramProof.approvedAt);
  return (
    matchesLoginEmailInteraction(intent, proof) &&
    intent.intentRef === proof.intentRef &&
    intent.candidateFingerprint === fingerprint &&
    intent.verificationRef === proof.verificationRef &&
    intent.telegramSubjectRef === proof.telegramProof.subjectRef &&
    intent.state === "pending" &&
    now < intent.expiresAt &&
    Number.isFinite(approvedAt) &&
    approvedAt <= now.getTime() + 30_000 &&
    now.getTime() - approvedAt <= 5 * 60_000
  );
}

export function canFinalizeLoginEmail(
  intent: LoginEmailIntent,
  receipt: NativeLoginEmailCommit,
  fingerprint: string,
): boolean {
  // TTL closes new reservations; it cannot undo a possibly committed provider write.
  return (
    matchesLoginEmailInteraction(intent, receipt) &&
    intent.intentRef === receipt.intentRef &&
    intent.candidateFingerprint === fingerprint &&
    intent.verificationRef === receipt.verificationRef &&
    ["reserved", "reconciliation_required", "finalized"].includes(intent.state)
  );
}
