import scenarios from "@inside/contracts/inside-community-discussions-v1/scenarios.json" with { type: "json" };
import { HttpCommunityDiscussionsProvider } from "../../src/modules/community-discussions/infrastructure/http-community-discussions-provider.js";
import type { z } from "zod";
import { expect, test } from "vitest";
import fixtures from "@inside/contracts/inside-community-discussions-v1/fixtures.json" with { type: "json" };
import {
  communityDiscussionsRequestSchema,
  communityDiscussionsSuccessSchema,
  communityDiscussionsErrorSchema,
} from "@inside/contracts/community-discussions";

const validators: Readonly<Record<string, z.ZodType>> = {
  request: communityDiscussionsRequestSchema,
  success: communityDiscussionsSuccessSchema,
  error: communityDiscussionsErrorSchema,
};
for (const fixture of fixtures)
  test(`shared discussion contract: ${fixture.name}`, () => {
    const schema = validators[fixture.definition];
    if (schema === undefined) throw new Error("Unknown fixture definition");
    expect(schema.safeParse(fixture.value).success).toBe(fixture.valid);
  });

for (const scenario of scenarios)
  test(`shared discussion provider scenario: ${scenario.name}`, async () => {
    // Input rejection belongs to the facet. The provider separately checks the remote HTTP answer.
    const request = communityDiscussionsRequestSchema.safeParse(
      scenario.request,
    );
    const fallback = communityDiscussionsRequestSchema.parse({
      contractVersion: "inside.community-discussions.v1",
      requestId: "request-1",
      operation: "discussions.list",
      actor: { accountRef: "synthetic-author" },
      limit: 20,
    });
    if (!request.success) expect(scenario.status).toBe(400);
    const provider = new HttpCommunityDiscussionsProvider(
      {
        endpoint:
          "http://127.0.0.1:9876/integrations/platform/v1/community-discussions",
        secret: "synthetic-discussions-secret",
      },
      () =>
        Promise.resolve(
          Response.json(scenario.response, { status: scenario.status }),
        ),
    );
    const result = await provider.execute(
      request.success ? request.data : fallback,
    );
    expect(result).toEqual(
      scenario.status === 200
        ? { ok: true, value: scenario.response }
        : {
            ok: false,
            error: {
              code: communityDiscussionsErrorSchema.parse(scenario.response)
                .status,
            },
          },
    );
  });
