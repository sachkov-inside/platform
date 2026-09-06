import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import fixtures from "../../src/modules/communications/contracts/inside-communications-v1/fixtures.json" with { type: "json" };
import schema from "../../src/modules/communications/contracts/inside-communications-v1/schema.json" with { type: "json" };
import * as generated from "../../src/modules/communications/communications-schema.generated.js";
import { communicationsSuccessSchema, managementRequestSchema } from "../../src/modules/communications/communications-contract.js";

const ajv = new Ajv({ strict: true });
addFormats.default(ajv);
ajv.addSchema(schema);
const validators: Readonly<Record<string, z.ZodType>> = generated;

describe("vendored communications contract", () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const validator = validators[`${fixture.definition}Schema`];
      expect(validator).toBeDefined();
      const valid = ajv.compile({ $ref: `${schema.$id}#/definitions/${fixture.definition}` });
      expect(valid(fixture.value)).toBe(fixture.valid);
      expect(validator?.safeParse(fixture.value).success).toBe(fixture.valid);
    });
  }
  test("success contracts exclude provider and application failures", () => {
    expect(communicationsSuccessSchema.safeParse({ ok: true, value: { contractVersion: "inside-communications-v1", status: "forbidden" } }).success).toBe(false);
    expect(communicationsSuccessSchema.safeParse({ ok: false, error: { code: "forbidden" } }).success).toBe(false);
  });
  test("public management refuses actors, service operations and destination overrides", () => {
    const request = {
      contractVersion: "inside-communications-v1", operation: "templates.testSend",
      operationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1,
      payload: { templateId: "22222222-2222-4222-8222-222222222222" },
    };
    expect(managementRequestSchema.safeParse(request).success).toBe(true);
    expect(managementRequestSchema.safeParse({ ...request, actor: { accountRef: "forged" } }).success).toBe(false);
    expect(managementRequestSchema.safeParse({ ...request, payload: { ...request.payload, chatId: "foreign" } }).success).toBe(false);
    expect(managementRequestSchema.safeParse({ ...request, operation: "tracking.resolve", payload: { token: "a".repeat(32) } }).success).toBe(false);
  });
});
