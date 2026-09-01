import { z } from "zod";

import type {
  PrivateMemberProfile,
  PrivateMemberProfileState,
  ProfileField,
} from "../model/member-profile";

const fieldsSchema = z.object({ bio: z.string().nullable(), displayName: z.string() }).strict();

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

export function parsePrivateProfileState(value: unknown): PrivateMemberProfileState {
  return parse(privateStateSchema, value, "Private Profile state");
}

export function parsePrivateProfile(value: unknown): PrivateMemberProfile {
  return parse(privateProfileResponseSchema, value, "Profile response").profile;
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
