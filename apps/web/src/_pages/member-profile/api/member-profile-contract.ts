import { z } from "zod";

import type { MemberProfileProjectionData } from "@/_pages/account";

const projectionResponseSchema = z
  .object({
    profile: z
      .object({
        bio: z.string().nullable(),
        displayName: z.string(),
        publicProfileId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export function parseMemberProfileProjection(
  value: unknown,
): MemberProfileProjectionData {
  return parse(
    projectionResponseSchema,
    value,
    "Member Profile projection",
  ).profile;
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  label: string,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`${label} does not match the API contract`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
