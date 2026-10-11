import { describe, expect, it } from "vitest";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import fixtures from "@inside/contracts/login-email-identity-v1/fixtures.json" with { type: "json" };
import schema from "@inside/contracts/login-email-identity-v1/schema.json" with { type: "json" };
import {
  beginLoginEmailIdentitySchema,
  selectLoginEmailCandidateSchema,
  reserveLoginEmailIdentitySchema,
  finalizeLoginEmailIdentitySchema,
  loginEmailIdentityResultSchema,
} from "../../src/modules/accounts/facets/login-email-identity/login-email-identity.contract.js";

describe("first Logto email identity intent boundary", () => {
  it("does not allow the authenticated client to select a target Account or Logto user", () => {
    expect(
      beginLoginEmailIdentitySchema.safeParse({
        commandRef: "46100000-0000-4000-8000-000000000001",
        accountId: "46100000-0000-4000-8000-000000000002",
        subject: "client-selected-target",
      }).success,
    ).toBe(false);
  });

  it("accepts the portable envelopes in Zod and its generated JSON projection", () => {
    expect(
      beginLoginEmailIdentitySchema.safeParse(fixtures.begin).success,
    ).toBe(true);
    expect(
      selectLoginEmailCandidateSchema.safeParse(fixtures.candidate).success,
    ).toBe(true);
    expect(
      reserveLoginEmailIdentitySchema.safeParse(fixtures.reservation).success,
    ).toBe(true);
    expect(
      finalizeLoginEmailIdentitySchema.safeParse(fixtures.finalization).success,
    ).toBe(true);
    expect(
      loginEmailIdentityResultSchema.safeParse(fixtures.result).success,
    ).toBe(true);
    for (const name of [
      "begin",
      "candidate",
      "reservation",
      "finalization",
      "result",
    ] as const) {
      expect(portableMatches(schema.definitions[name], fixtures[name])).toBe(
        true,
      );
    }
  });

  it.each(["code", "billingContactCode", "accessToken", "accountId"])(
    "rejects %s outside the native Logto code boundary",
    (field) => {
      const candidate = { ...fixtures.candidate, [field]: "client-selected" };
      const reservation = {
        ...fixtures.reservation,
        [field]: "client-selected",
      };
      expect(selectLoginEmailCandidateSchema.safeParse(candidate).success).toBe(
        false,
      );
      expect(
        reserveLoginEmailIdentitySchema.safeParse(reservation).success,
      ).toBe(false);
      expect(portableMatches(schema.definitions.candidate, candidate)).toBe(
        false,
      );
      expect(portableMatches(schema.definitions.reservation, reservation)).toBe(
        false,
      );
    },
  );

  it("does not represent an unknown provider outcome as an attached receipt", () => {
    const unknown = {
      ...fixtures.finalization,
      receipt: { ...fixtures.finalization.receipt, state: "unknown" },
    };
    expect(finalizeLoginEmailIdentitySchema.safeParse(unknown).success).toBe(
      false,
    );
    expect(portableMatches(schema.definitions.finalization, unknown)).toBe(
      false,
    );
  });
});

/** A portable envelope must compile with standard JSON Schema formats and match its fixture. */
function portableMatches(definition: object, value: unknown): boolean {
  const ajv = new Ajv();
  addFormats.default(ajv);
  try {
    return ajv.compile(definition)(value);
  } catch {
    return false;
  }
}
