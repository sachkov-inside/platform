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
