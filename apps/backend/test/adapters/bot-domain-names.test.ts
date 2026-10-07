import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { expect, test } from "vitest";
import previousContract from "./fixtures/subscription-activation-before-domain-names.json" with { type: "json" };
import {
  botDomainResponse,
  BOT_DOMAIN_NAMES_VERSION,
} from "../../src/modules/telegram-membership/domain/bot-domain-names.js";
import { activationResponseSchema } from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";

const id = "10000000-0000-4000-8000-000000000001";
const response = {
  ok: true,
  value: {
    contractVersion: "inside.subscription-activation.v1",
    attemptId: id,
    state: "active",
    enrollment: {
      id,
      accountId: id,
      tier: {
        id,
        revision: 1,
        name: "Course",
        benefits: [`product:${id}`, "community"],
        coverage: { productIds: [id], materialIds: [] },
        benefitPeriods: [{ capability: `product:${id}`, months: null }],
      },
      origin: "course",
      startsAt: "2030-01-01T00:00:00.000Z",
      endsAt: null,
      endPolicy: "fixed",
      revision: 1,
      state: "active",
      renewal: "not_applicable",
      content: [
        {
          kind: "product",
          id,
          title: "Course",
          slug: "course",
          available: true,
        },
      ],
    },
  },
};

test("the deployed bot accepts activation after Platform ships first; the upgraded bot opts into Product names", () => {
  const ajv = new Ajv({ strict: false });
  addFormats.default(ajv);
  ajv.addSchema(previousContract);
  const validOld = ajv.compile({
    $ref: `${previousContract.$id}#/definitions/activationResponse`,
  });
  const legacy = botDomainResponse(response, undefined);
  expect(validOld(legacy), JSON.stringify(validOld.errors)).toBe(true);
  expect(validOld(response)).toBe(false);
  expect(activationResponseSchema.safeParse(legacy).success).toBe(true);
  const canonical = botDomainResponse(response, BOT_DOMAIN_NAMES_VERSION);
  expect(canonical).toEqual(response);
  expect(activationResponseSchema.safeParse(canonical).success).toBe(true);
});
