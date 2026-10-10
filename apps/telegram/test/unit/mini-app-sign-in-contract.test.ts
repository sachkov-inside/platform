import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import fixtures from "@inside/contracts/mini-app-sign-in-v1/fixtures.json" with { type: "json" };
import schema from "@inside/contracts/mini-app-sign-in-v1/schema.json" with { type: "json" };
import {
  miniAppApprovalSchema,
  miniAppBindingSchema,
  miniAppRegistrationSchema,
} from "../../src/modules/bot-sign-in/mini-app-sign-in.contract.js";

describe("Mini App portable request contract", () => {
  it("requires the private launch browser secret in addition to the public OIDC digest", () => {
    const publicTranscript = structuredClone(fixtures.binding);
    Reflect.deleteProperty(publicTranscript, "launchBrowserSecret");
    expect(miniAppBindingSchema.safeParse(publicTranscript).success).toBe(
      false,
    );
    const ajv = new Ajv({ validateFormats: false });
    expect(ajv.compile(schema.definitions.binding)(publicTranscript)).toBe(
      false,
    );
  });
  it("requires the original OIDC state and PKCE context binding on registration", () => {
    const unbound = structuredClone(fixtures.registration);
    Reflect.deleteProperty(unbound, "oidcContextDigest");
    expect(miniAppRegistrationSchema.safeParse(unbound).success).toBe(false);
  });
  it("accepts portable fixtures at the owning provider boundary and JSON projection", () => {
    // Built-in Zod patterns carry the constraints; base64url is not a standard AJV format.
    const ajv = new Ajv({ validateFormats: false });
    expect(
      miniAppRegistrationSchema.safeParse(fixtures.registration).success,
    ).toBe(true);
    expect(miniAppApprovalSchema.safeParse(fixtures.approval).success).toBe(
      true,
    );
    expect(miniAppBindingSchema.safeParse(fixtures.binding).success).toBe(true);
    expect(
      ajv.compile(schema.definitions.registration)(fixtures.registration),
    ).toBe(true);
    expect(ajv.compile(schema.definitions.approval)(fixtures.approval)).toBe(
      true,
    );
    expect(ajv.compile(schema.definitions.binding)(fixtures.binding)).toBe(
      true,
    );
  });

  it.each(["accountRef", "subject", "source", "initDataUnsafe", "start_param"])(
    "rejects client-selected ownership field %s",
    (field) => {
      const registration = {
        ...fixtures.registration,
        [field]: "client-selected",
      };
      const approval = { ...fixtures.approval, [field]: "client-selected" };
      const binding = { ...fixtures.binding, [field]: "client-selected" };
      const ajv = new Ajv({ validateFormats: false });
      expect(miniAppRegistrationSchema.safeParse(registration).success).toBe(
        false,
      );
      expect(miniAppApprovalSchema.safeParse(approval).success).toBe(false);
      expect(miniAppBindingSchema.safeParse(binding).success).toBe(false);
      expect(ajv.compile(schema.definitions.registration)(registration)).toBe(
        false,
      );
      expect(ajv.compile(schema.definitions.approval)(approval)).toBe(false);
      expect(ajv.compile(schema.definitions.binding)(binding)).toBe(false);
    },
  );

  it("rejects an unversioned or oversized proof envelope", () => {
    expect(
      miniAppApprovalSchema.safeParse({
        ...fixtures.approval,
        contractVersion: "inside.bot-sign-in.v1",
      }).success,
    ).toBe(false);
    expect(
      miniAppApprovalSchema.safeParse({
        ...fixtures.approval,
        initData: "x".repeat(16_385),
      }).success,
    ).toBe(false);
  });
});
