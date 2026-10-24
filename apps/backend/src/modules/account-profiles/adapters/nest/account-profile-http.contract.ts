import { z } from "zod";

export const accountProfileFieldsSchema = z
  .object({
    displayName: z.string(),
    bio: z.string().nullable(),
  })
  .strict();

export const accountProfileAvatarSchema = z
  .object({ avatarId: z.uuid() })
  .strict();

export const privateAccountProfileSchema = accountProfileFieldsSchema
  .extend({
    avatar: accountProfileAvatarSchema.nullable(),
    status: z.enum(["active", "disabled"]),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const privateProfileStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }).strict(),
  z
    .object({
      kind: z.literal("profile"),
      profile: privateAccountProfileSchema,
    })
    .strict(),
]);

export const accountProfileMutationBodySchema = z
  .object({ displayName: z.string(), bio: z.string().optional().nullable() })
  .strict();

export const updateAccountProfileBodySchema = accountProfileMutationBodySchema
  .extend({ expectedVersion: z.number().int().positive() })
  .strict();

export const accountProfileResponseSchema = z
  .object({ profile: privateAccountProfileSchema })
  .strict();

export const profileValidationIssueSchema = z
  .object({
    field: z.enum(["displayName", "bio"]),
    code: z.enum(["required", "too_short", "too_long", "invalid_characters"]),
  })
  .strict();

export const accountProfileProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    code: z.enum([
      "invalid_input",
      "profile_exists",
      "profile_not_found",
      "conflict",
      "internal_error",
    ]),
    issues: z.array(profileValidationIssueSchema).optional(),
    currentVersion: z.number().int().positive().optional(),
    correlationId: z.uuid().optional(),
  })
  .strict();
