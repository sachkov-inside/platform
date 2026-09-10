import { createHash } from "node:crypto";

import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, test } from "vitest";

import fixtures from "../../../../docs/contracts/billing-v1/fixtures.json" with { type: "json" };
import schema from "../../../../docs/contracts/billing-v1/schema.json" with { type: "json" };
import {
  canonicalJson,
  contractDigest,
} from "../../src/infrastructure/contracts/canonical-digest.js";
import {
  communityResultSchema,
  communitySetSchema,
  dispatchAuthorizeSchema,
  dispatchResultSchema,
} from "../../src/modules/telegram-membership/domain/community-entitlement.js";

const ajv = new Ajv({ strict: true, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(schema);
const validate = ajv.compile({ $ref: `${schema.$id}#` });

/**
 * The provider's own canonical form, written out independently. Both applications must
 * fingerprint the same bytes, so this is a cross-implementation check, not a self-check.
 */
function providerCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(providerCanonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${providerCanonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("community entitlement wire agreement", () => {
  test("the payload fingerprint matches the provider's canonical form", () => {
    for (const fixture of fixtures) {
      if (fixture.definition !== "communityRequest" || !fixture.valid) continue;
      expect(contractDigest(fixture.value)).toBe(
        createHash("sha256")
          .update(providerCanonicalJson(fixture.value))
          .digest("hex"),
      );
    }
  });

  test("object key order is irrelevant and array order is preserved", () => {
    expect(canonicalJson({ b: 1, a: [2, 3] })).toBe(canonicalJson({ a: [2, 3], b: 1 }));
    expect(contractDigest([1, 2])).not.toBe(contractDigest([2, 1]));
    expect(contractDigest({ a: "Ä" })).toBe(contractDigest({ a: "Ä" }));
  });

  test("valid contract examples parse and invalid ones are refused", () => {
    for (const fixture of fixtures) {
      const codec =
        fixture.definition === "communityRequest"
          ? communitySetSchema
          : fixture.definition === "communityResponse"
            ? communityResultSchema
            : fixture.definition === "authorizationRequest"
              ? dispatchAuthorizeSchema
              : undefined;
      if (codec === undefined) continue;
      const parsed = codec.safeParse(fixture.value);
      const isStatusQuery =
        typeof fixture.value === "object" &&
        fixture.value !== null &&
        "operation" in fixture.value &&
        fixture.value.operation !== "entitlement.set" &&
        fixture.value.operation !== "entitlement.result";
      if (fixture.valid && !isStatusQuery) {
        expect(parsed.success, fixture.name).toBe(true);
      }
      if (!fixture.valid) expect(parsed.success, fixture.name).toBe(false);
    }
  });

  test("a produced permit is a valid contract message", () => {
    const permit = dispatchResultSchema.parse({
      attemptId: "00000000-0000-4000-8000-0000000000a1",
      contractVersion: "inside.billing-dispatch.v1",
      decision: {
        permitRef: "00000000-0000-4000-8000-0000000000a2",
        status: "allowed",
        validUntil: "2030-01-01T00:00:05.000Z",
      },
      dispatchId: "00000000-0000-4000-8000-0000000000a3",
      operation: "dispatch.result",
      operationId: "00000000-0000-4000-8000-0000000000a4",
    });
    expect(validate(permit), JSON.stringify(validate.errors)).toBe(true);
  });

  test("an applied result must agree with its observed membership", () => {
    const base = {
      access: { kind: "lifetime" as const },
      binding: {
        accountRef: "account-ref",
        linkRef: "00000000-0000-4000-8000-0000000000b1",
        linkRevision: 1,
        telegramIdentityRef: "identity-ref",
      },
      contractVersion: "inside.community-entitlement.v1" as const,
      entitlementRevision: 1,
      operation: "entitlement.result" as const,
      operationId: "00000000-0000-4000-8000-0000000000b2",
      updatedAt: "2030-01-01T00:00:00.000Z",
    };
    expect(
      communityResultSchema.safeParse({
        ...base,
        observedMembership: "member",
        status: "applied",
      }).success,
    ).toBe(true);
    // A queue acknowledgement can never be presented as observed membership.
    expect(
      communityResultSchema.safeParse({
        ...base,
        observedMembership: "unknown",
        status: "applied",
      }).success,
    ).toBe(false);
  });
});
