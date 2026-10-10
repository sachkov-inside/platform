import { describe, expect, it } from "vitest";
import {
  canFinalizeLoginEmail,
  canReserveLoginEmail,
  type LoginEmailIntent,
  type NativeLoginEmailCandidate,
  type NativeLoginEmailCommit,
} from "../../src/modules/accounts/features/login-email-identity/login-email-policy.js";

const now = new Date("2026-10-10T03:00:00.000Z");
const fingerprint = `v1:${"a".repeat(64)}`;
const intent: LoginEmailIntent = {
  intentRef: "46100000-0000-4000-8000-000000000001",
  accountId: "46100000-0000-4000-8000-000000000002",
  ownerIdentity: {
    issuer: "https://identity.example.test/oidc",
    subject: "same-owner",
  },
  interactionRef: "existing-native-interaction",
  browserBindingDigest: "b".repeat(64),
  state: "reserved",
  candidateFingerprint: fingerprint,
  verificationRef: "native-email-record",
  telegramSubjectRef: "46100000-0000-4000-8000-000000000003",
  expiresAt: new Date(now.getTime() - 1),
};
const receipt: NativeLoginEmailCommit = {
  ...intent,
  intentRef: intent.intentRef,
  state: "attached",
  email: "first@example.test",
  verificationRef: "native-email-record",
};
const candidate: NativeLoginEmailCandidate = {
  ...receipt,
  telegramProof: {
    subjectRef: intent.telegramSubjectRef,
    requestRef: "46100000-0000-4000-8000-000000000004",
    approvedAt: now.toISOString(),
  },
};

describe("Accounts first-email policy (trusted boundary fixtures, no provider proof)", () => {
  it("finalizes a late authoritative commit after intent TTL without releasing its reservation", () => {
    expect(canFinalizeLoginEmail(intent, receipt, fingerprint)).toBe(true);
  });
});

describe("binding and fresh proof controls", () => {
  const pending = {
    ...intent,
    state: "pending" as const,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  it("reserves only a live exact candidate with fresh proof of the same Telegram owner", () => {
    expect(canReserveLoginEmail(pending, candidate, fingerprint, now)).toBe(
      true,
    );
  });
  it.each([
    {
      ...candidate,
      ownerIdentity: { ...candidate.ownerIdentity, subject: "another-owner" },
    },
    {
      ...candidate,
      ownerIdentity: {
        ...candidate.ownerIdentity,
        issuer: "https://other.example.test/oidc",
      },
    },
    { ...candidate, intentRef: "46100000-0000-4000-8000-000000000099" },
    { ...candidate, interactionRef: "another-interaction" },
    { ...candidate, browserBindingDigest: "c".repeat(64) },
    { ...candidate, verificationRef: "old-code-record" },
    {
      ...candidate,
      telegramProof: {
        ...candidate.telegramProof,
        subjectRef: "46100000-0000-4000-8000-000000000099",
      },
    },
    {
      ...candidate,
      telegramProof: {
        ...candidate.telegramProof,
        approvedAt: new Date(now.getTime() - 300_001).toISOString(),
      },
    },
    {
      ...candidate,
      telegramProof: {
        ...candidate.telegramProof,
        approvedAt: new Date(now.getTime() + 30_001).toISOString(),
      },
    },
  ])(
    "rejects cross-owner/intent/browser/record or stale Telegram proof before reservation %#",
    (proof) => {
      expect(canReserveLoginEmail(pending, proof, fingerprint, now)).toBe(
        false,
      );
    },
  );
  it("does not reserve an expired intent or another normalized candidate", () => {
    expect(
      canReserveLoginEmail(
        { ...pending, expiresAt: now },
        candidate,
        fingerprint,
        now,
      ),
    ).toBe(false);
    expect(
      canReserveLoginEmail(pending, candidate, `v1:${"d".repeat(64)}`, now),
    ).toBe(false);
  });
  it.each(["pending", "superseded"] as const)(
    "does not finalize an unreserved %s intent",
    (state) => {
      expect(
        canFinalizeLoginEmail({ ...intent, state }, receipt, fingerprint),
      ).toBe(false);
    },
  );
  it.each([
    { ...receipt, intentRef: "46100000-0000-4000-8000-000000000099" },
    {
      ...receipt,
      ownerIdentity: { ...receipt.ownerIdentity, subject: "another-owner" },
    },
    { ...receipt, interactionRef: "other-native-interaction" },
    { ...receipt, browserBindingDigest: "c".repeat(64) },
    { ...receipt, verificationRef: "other-record" },
  ])("does not finalize a mismatched commit %#", (proof) => {
    expect(canFinalizeLoginEmail(intent, proof, fingerprint)).toBe(false);
  });
  it("uses the same bound receipt for reconciliation and repeated finalization", () => {
    expect(
      canFinalizeLoginEmail(
        { ...intent, state: "reconciliation_required" },
        receipt,
        fingerprint,
      ),
    ).toBe(true);
    expect(
      canFinalizeLoginEmail(
        { ...intent, state: "finalized" },
        receipt,
        fingerprint,
      ),
    ).toBe(true);
    expect(canFinalizeLoginEmail(intent, receipt, `v1:${"d".repeat(64)}`)).toBe(
      false,
    );
  });
});
