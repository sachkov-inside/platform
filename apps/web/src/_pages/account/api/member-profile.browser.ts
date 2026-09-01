import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { ProfileMutationState } from "../model/member-profile";
import { parsePrivateProfile } from "./member-profile-contract";

const mutationStateSchema = z.discriminatedUnion("kind", [
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

export function saveMemberProfile(formData: FormData): Promise<ProfileMutationState> {
  return mutateProfile(formData);
}

async function mutateProfile(formData: FormData): Promise<ProfileMutationState> {
  const result = await requestSameOriginMutation(
    "/api/account/profile",
    "POST",
    formData,
  );
  if (!result.ok) {
    return result.status === 401 || result.status === 403
      ? { kind: "unauthorized" }
      : { kind: "unavailable", reference: `profile-bff-${String(result.status)}` };
  }

  const parsed = mutationStateSchema.safeParse(result.body);
  if (!parsed.success) {
    return { kind: "unavailable", reference: "profile-bff-contract" };
  }
  if (parsed.data.kind === "saved") {
    return { kind: "saved", profile: parsePrivateProfile({ profile: parsed.data.profile }) };
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
  if (parsed.data.kind === "conflict") {
    return parsed.data.currentVersion === undefined
      ? { kind: "conflict" }
      : { currentVersion: parsed.data.currentVersion, kind: "conflict" };
  }
  return parsed.data;
}
