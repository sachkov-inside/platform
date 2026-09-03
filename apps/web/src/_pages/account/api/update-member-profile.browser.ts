import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type {
  UpdateMemberProfileInput,
  UpdateMemberProfileResult,
} from "../model/update-member-profile";
import { parsePrivateProfile } from "@/entities/member-profile";

const resultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), profile: z.unknown() }).strict(),
  z
    .object({
      fieldErrors: z
        .object({ bio: z.string().optional(), displayName: z.string().optional() })
        .strict(),
      kind: z.literal("invalid_input"),
    })
    .strict(),
  z
    .object({ currentVersion: z.number().int().positive().optional(), kind: z.literal("conflict") })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable"), reference: z.string() }).strict(),
]);

export async function updateMemberProfile(
  input: UpdateMemberProfileInput,
): Promise<UpdateMemberProfileResult> {
  const formData = new FormData();
  formData.set("bio", input.bio);
  formData.set("displayName", input.displayName);
  formData.set("expectedVersion", String(input.expectedVersion));
  const response = await requestSameOriginMutation(
    "/api/account/profile",
    "PUT",
    formData,
  );
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { kind: "unauthorized" }
      : {
          kind: "unavailable",
          reference: `update-member-profile-bff-${String(response.status)}`,
        };
  }

  const parsed = resultSchema.safeParse(response.body);
  if (!parsed.success) {
    return { kind: "unavailable", reference: "update-member-profile-bff-contract" };
  }
  if (parsed.data.kind === "saved") {
    try {
      return { kind: "saved", profile: parsePrivateProfile({ profile: parsed.data.profile }) };
    } catch {
      return { kind: "unavailable", reference: "update-member-profile-bff-contract" };
    }
  }
  if (parsed.data.kind === "invalid_input") {
    return {
      fieldErrors: {
        ...(parsed.data.fieldErrors.bio === undefined
          ? {}
          : { bio: parsed.data.fieldErrors.bio }),
        ...(parsed.data.fieldErrors.displayName === undefined
          ? {}
          : { displayName: parsed.data.fieldErrors.displayName }),
      },
      kind: "invalid_input",
    };
  }
  if (parsed.data.kind !== "conflict") return parsed.data;
  return parsed.data.currentVersion === undefined
    ? { kind: "conflict" }
    : { currentVersion: parsed.data.currentVersion, kind: "conflict" };
}
