import "server-only";

import { z } from "zod";

import type {
  MemberProfileProjection,
  PrivateMemberProfile,
  PrivateMemberProfileState,
  ProfileField,
} from "../model/member-profile";

const fieldsSchema = z
  .object({ bio: z.string().nullable(), displayName: z.string() })
  .strict();

const privateProfileSchema = fieldsSchema
  .extend({
    createdAt: z.iso.datetime(),
    publicProfileId: z.uuid(),
    status: z.enum(["active", "disabled"]),
    updatedAt: z.iso.datetime(),
    version: z.number().int().positive(),
  })
  .strict();

const privateStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }).strict(),
  z.object({ kind: z.literal("profile"), profile: privateProfileSchema }).strict(),
]);

const privateProfileResponseSchema = z
  .object({ profile: privateProfileSchema })
  .strict();

const projectionResponseSchema = z
  .object({
    profile: fieldsSchema.extend({ publicProfileId: z.uuid() }).strict(),
  })
  .strict();

const reportResponseSchema = z
  .object({ outcome: z.enum(["recorded", "already_recorded"]) })
  .strict();

const exportResponseSchema = z
  .object({
    profile: fieldsSchema,
    schemaVersion: z.literal("member-profile-export.v1"),
  })
  .strict();

const problemSchema = z
  .object({
    code: z.string(),
    correlationId: z.string().optional(),
    currentVersion: z.number().int().positive().optional(),
    issues: z
      .array(
        z
          .object({
            code: z.enum([
              "required",
              "too_short",
              "too_long",
              "invalid_characters",
            ]),
            field: z.enum(["bio", "displayName"]),
          })
          .strict(),
      )
      .optional(),
    status: z.number().int(),
  })
  .loose();

export type MemberProfileProblem = Readonly<z.infer<typeof problemSchema>>;

export function parsePrivateProfileState(value: unknown): PrivateMemberProfileState {
  return parse(privateStateSchema, value, "Private Profile state");
}

export function parsePrivateProfile(value: unknown): PrivateMemberProfile {
  return parse(privateProfileResponseSchema, value, "Profile response").profile;
}

export function parseMemberProfileProjection(value: unknown): MemberProfileProjection {
  return parse(projectionResponseSchema, value, "Member Profile projection").profile;
}

export function parseReportOutcome(value: unknown): "already_recorded" | "recorded" {
  return parse(reportResponseSchema, value, "Profile report response").outcome;
}

export function parseProfileExport(value: unknown): Readonly<{
  profile: { readonly bio: string | null; readonly displayName: string };
  schemaVersion: "member-profile-export.v1";
}> {
  return parse(exportResponseSchema, value, "Profile export response");
}

export function parseMemberProfileProblem(value: unknown): MemberProfileProblem | null {
  const parsed = problemSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function profileIssueMessage(field: ProfileField, code: string): string {
  if (field === "displayName") {
    if (code === "required") return "Укажите имя.";
    if (code === "too_short") return "Имя должно содержать хотя бы 2 символа.";
    if (code === "too_long") return "Имя должно быть не длиннее 80 символов.";
    return "Имя содержит недопустимые управляющие символы.";
  }
  if (code === "too_long") return "Описание должно быть не длиннее 500 символов.";
  return "Описание содержит недопустимые управляющие символы.";
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
