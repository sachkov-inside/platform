import { describe, expect, test } from "vitest";

import { validateMembershipEvidence } from "../../src/modules/membership-entitlements/features/accept-evidence/validate-membership-evidence.js";

const clock = new Date("2030-01-01T00:04:00Z");

describe("MembershipEvidence validation", () => {
  test("accepts the exact contract with RFC 3339 numeric offsets", () => {
    expect(
      validateMembershipEvidence(
        observedEvidence({
          checkedAt: "2030-01-01T03:00:00+03:00",
          validUntil: "2030-01-01T03:05:00+03:00",
        }),
        clock,
      ),
    ).toMatchObject({ ok: true, value: { decision: "member" } });
  });

  test("separates unsupported, malformed, invalid-time and expired evidence", () => {
    expect(
      validateMembershipEvidence(
        { ...observedEvidence(), contractVersion: "inside.membership-evidence.v2" },
        clock,
      ),
    ).toEqual({ ok: false, error: { code: "unsupported_contract" } });
    expect(
      validateMembershipEvidence(
        {
          contractVersion: "inside.membership-evidence.v1",
          principalRef: "principal-ref-a",
          decision: "member",
          reasonCode: "chat_member",
        },
        clock,
      ),
    ).toEqual({ ok: false, error: { code: "invalid_evidence" } });
    expect(
      validateMembershipEvidence(
        observedEvidence({ validUntil: "2030-01-01T00:05:01Z" }),
        clock,
      ),
    ).toEqual({ ok: false, error: { code: "invalid_evidence" } });
    expect(
      validateMembershipEvidence(
        observedEvidence({
          checkedAt: "2029-12-31T23:55:00Z",
          validUntil: "2030-01-01T00:00:00Z",
        }),
        clock,
      ),
    ).toEqual({ ok: false, error: { code: "expired_evidence" } });
  });

  test("accepts non-observation decisions without inventing an entitlement", () => {
    expect(
      validateMembershipEvidence(
        {
          contractVersion: "inside.membership-evidence.v1",
          principalRef: "principal-ref-a",
          decision: "unavailable",
          reasonCode: "provider_unavailable",
        },
        clock,
      ),
    ).toEqual({
      ok: true,
      value: {
        contractVersion: "inside.membership-evidence.v1",
        principalRef: "principal-ref-a",
        decision: "unavailable",
        reasonCode: "provider_unavailable",
      },
    });
  });
});

function observedEvidence(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    contractVersion: "inside.membership-evidence.v1",
    principalRef: "principal-ref-a",
    decision: "member",
    reasonCode: "chat_member",
    checkedAt: "2030-01-01T00:00:00Z",
    validUntil: "2030-01-01T00:05:00Z",
    telegramIdentityRef: "telegram-ref-a",
    evidenceRef: "evidence-ref-a-4",
    evidenceVersion: 4,
    ...overrides,
  };
}
