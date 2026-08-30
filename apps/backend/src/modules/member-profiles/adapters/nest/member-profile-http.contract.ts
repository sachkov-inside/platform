import { z } from "zod";

export const memberProfileFieldsSchema = z
  .object({
    displayName: z.string(),
    bio: z.string().nullable(),
  })
  .strict();

export const privateMemberProfileSchema = memberProfileFieldsSchema
  .extend({
    publicProfileId: z.uuid(),
    status: z.enum(["active", "disabled"]),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const privateProfileStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }).strict(),
  z
    .object({ kind: z.literal("profile"), profile: privateMemberProfileSchema })
    .strict(),
]);

export const memberProfileProjectionSchema = memberProfileFieldsSchema
  .extend({ publicProfileId: z.uuid() })
  .strict();

export const memberProfileMutationBodySchema = z
  .object({ displayName: z.string(), bio: z.string().optional().nullable() })
  .strict();

export const updateMemberProfileBodySchema = memberProfileMutationBodySchema
  .extend({ expectedVersion: z.number().int().positive() })
  .strict();

export const deleteMemberProfileBodySchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();

export const reportMemberProfileBodySchema = z
  .object({ reason: z.enum(["unsafe_content", "impersonation", "other"]) })
  .strict();

export const memberProfileResponseSchema = z
  .object({ profile: privateMemberProfileSchema })
  .strict();

export const memberProfileProjectionResponseSchema = z
  .object({ profile: memberProfileProjectionSchema })
  .strict();

export const profileDeleteResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();

export const profileReportResponseSchema = z
  .object({ outcome: z.enum(["recorded", "already_recorded"]) })
  .strict();

export const profileExportSchema = z
  .object({
    schemaVersion: z.literal("member-profile-export.v1"),
    profile: memberProfileFieldsSchema,
  })
  .strict();

export const profileValidationIssueSchema = z
  .object({
    field: z.enum(["displayName", "bio"]),
    code: z.enum([
      "required",
      "too_short",
      "too_long",
      "invalid_characters",
    ]),
  })
  .strict();

export const memberProfileProblemSchema = z
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
