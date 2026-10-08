import { z } from "zod";

/** Operator-only Platform response; absence from the list does not establish a right. */
export const communityMembersWithoutRightSchema: z.ZodObject<{
  checkedAt: z.ZodISODateTime;
  items: z.ZodArray<z.ZodObject<{
    accountId: z.ZodUUID;
    telegramIdentityRef: z.ZodString;
    observedAt: z.ZodISODateTime;
  }, z.core.$strict>>;
  truncated: z.ZodBoolean;
}, z.core.$strict> = z.strictObject({
  checkedAt: z.iso.datetime({ offset: true }),
  items: z.array(z.strictObject({
    accountId: z.uuid(),
    telegramIdentityRef: z.string(),
    observedAt: z.iso.datetime({ offset: true }),
  })),
  truncated: z.boolean(),
});

export type CommunityMembersWithoutRight = z.infer<typeof communityMembersWithoutRightSchema>;
