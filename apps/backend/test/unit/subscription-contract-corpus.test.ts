import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, test } from "vitest";
import activationSchema from "../../../../docs/contracts/subscription-activation-v1/schema.json" with { type: "json" };
import activationFixtures from "../../../../docs/contracts/subscription-activation-v1/fixtures.json" with { type: "json" };
import communitySchema from "../../../../docs/contracts/community-v2/schema.json" with { type: "json" };
import communityFixtures from "../../../../docs/contracts/community-v2/fixtures.json" with { type: "json" };
import { beginActivationSchema, activationEvidenceSchema, ownSubscriptionAccessQuerySchema } from "../../src/modules/membership-entitlements/index.js";
import { activationResponseSchema, ownSubscriptionAccessResponseSchema } from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import { communitySetSchema, communityStatusQuerySchema, communityResultSchema, communityErrorSchema, dispatchAuthorizeSchema, dispatchResultSchema, dispatchErrorSchema } from "../../src/modules/telegram-membership/domain/community-entitlement.js";
import { z } from "zod";
const activationCodecs: Record<string, z.ZodType> = { begin: beginActivationSchema, evidence: activationEvidenceSchema, ownAccessQuery: ownSubscriptionAccessQuerySchema, activationResponse: activationResponseSchema, ownAccessResponse: ownSubscriptionAccessResponseSchema };
const communityCodecs: Record<string, z.ZodType> = { communityRequest: z.union([communitySetSchema, communityStatusQuerySchema]), communityResponse: z.union([communityResultSchema, communityErrorSchema]), authorizationRequest: dispatchAuthorizeSchema, authorizationResponse: z.union([dispatchResultSchema, dispatchErrorSchema]) };
describe("portable subscription contracts agree with production codecs", () => {
  for (const bundle of [{ schema: activationSchema, fixtures: activationFixtures, codecs: activationCodecs }, { schema: communitySchema, fixtures: communityFixtures, codecs: communityCodecs }]) {
    const ajv = new Ajv({ strict: true, allErrors: true }); addFormats.default(ajv); ajv.addSchema(bundle.schema);
    for (const fixture of bundle.fixtures) test(fixture.name, () => {
      const validate = ajv.compile({ $ref: `${bundle.schema.$id}#/definitions/${fixture.definition}` });
      expect(validate(fixture.value), JSON.stringify(validate.errors)).toBe(fixture.valid);
      expect(bundle.codecs[fixture.definition]?.safeParse(fixture.value).success).toBe(fixture.valid);
    });
  }
});
