import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import fixtures from "@inside/contracts/mini-app-sign-in-v1/fixtures.json" with { type: "json" };
import schema from "@inside/contracts/mini-app-sign-in-v1/schema.json" with { type: "json" };
import {
  miniAppApprovalSchema,
  miniAppRegistrationSchema,
} from "../../src/modules/bot-sign-in/mini-app-sign-in.contract.js";

describe("Mini App portable request contract", () => {
  it("accepts portable fixtures at the owning provider boundary and JSON projection", () => {
    // Built-in Zod patterns carry the constraints; base64url is not a standard AJV format.
    const ajv = new Ajv({ validateFormats: false });
    expect(
      miniAppRegistrationSchema.safeParse(fixtures.registration).success,
    ).toBe(true);
    expect(miniAppApprovalSchema.safeParse(fixtures.approval).success).toBe(
      true,
    );
    expect(
      ajv.compile(schema.definitions.registration)(fixtures.registration),
    ).toBe(true);
    expect(ajv.compile(schema.definitions.approval)(fixtures.approval)).toBe(
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
      const ajv = new Ajv({ validateFormats: false });
      expect(miniAppRegistrationSchema.safeParse(registration).success).toBe(
        false,
      );
      expect(miniAppApprovalSchema.safeParse(approval).success).toBe(false);
      expect(ajv.compile(schema.definitions.registration)(registration)).toBe(
        false,
      );
      expect(ajv.compile(schema.definitions.approval)(approval)).toBe(false);
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
