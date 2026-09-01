import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestMemberProfileCreation,
  requestMemberProfileUpdate,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { ProfileMutationState } from "../model/member-profile";
import { parseMemberProfileProblem } from "@/entities/member-profile";
import {
  parsePrivateProfile,
  profileIssueMessage,
} from "./member-profile-contract";

const textField = z.string().refine((value) => !hasRejectedControlCharacters(value));
const profileFieldsSchema = z.object({
  bio: textField.refine((value) => codePointLength(value) <= 500),
  displayName: textField.refine((value) => {
    const length = codePointLength(value.trim());
    return length >= 2 && length <= 80;
  }),
});
const profileFormSchema = z.discriminatedUnion("mode", [
  profileFieldsSchema.extend({
    mode: z.literal("create"),
  }),
  profileFieldsSchema.extend({
    expectedVersion: z.coerce.number().int().positive(),
    mode: z.literal("update"),
  }),
]);

export interface ProfileMutationDependencies {
  readonly create: typeof requestMemberProfileCreation;
  readonly update: typeof requestMemberProfileUpdate;
}

const productionDependencies: ProfileMutationDependencies = {
  create: requestMemberProfileCreation,
  update: requestMemberProfileUpdate,
};

export async function executeSaveMemberProfile(
  formData: FormData,
  accessToken: string,
  dependencies: ProfileMutationDependencies = productionDependencies,
): Promise<ProfileMutationState> {
  const parsed = profileFormSchema.safeParse({
    bio: formData.get("bio"),
    displayName: formData.get("displayName"),
    expectedVersion: formData.get("expectedVersion"),
    mode: formData.get("mode"),
  });
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    return {
      fieldErrors: {
        ...(fields.has("bio")
          ? { bio: "Описание должно быть не длиннее 500 символов." }
          : {}),
        ...(fields.has("displayName")
          ? { displayName: "Укажите имя длиной от 2 до 80 символов." }
          : {}),
      },
      kind: "invalid_input",
    };
  }

  let result: BackendTransportResult;
  try {
    const input = {
      bio: emptyToNull(parsed.data.bio),
      displayName: parsed.data.displayName.trim(),
    };
    result =
      parsed.data.mode === "create"
        ? await dependencies.create(input, accessToken)
        : await dependencies.update(
            { ...input, expectedVersion: parsed.data.expectedVersion },
            accessToken,
          );
  } catch (error) {
    return unavailable(error);
  }
  if (result.ok) {
    try {
      return { kind: "saved", profile: parsePrivateProfile(result.body) };
    } catch (error) {
      return unavailable(error);
    }
  }
  return mapProblem(result);
}

function mapProblem(
  result: Extract<BackendTransportResult, { readonly ok: false }>,
): ProfileMutationState {
  if (result.response.status === 401) return { kind: "unauthorized" };
  const problem = parseMemberProfileProblem(result.problem);
  if (problem?.code === "invalid_input") {
    const fieldErrors: Partial<Record<"bio" | "displayName", string>> = {};
    for (const issue of problem.issues ?? []) {
      fieldErrors[issue.field] = profileIssueMessage(issue.field, issue.code);
    }
    if (problem.issues === undefined) {
      fieldErrors.displayName = "Проверьте имя и повторите сохранение.";
      fieldErrors.bio = "Проверьте описание и повторите сохранение.";
    }
    return { fieldErrors, kind: "invalid_input" };
  }
  if (
    problem?.code === "conflict" ||
    problem?.code === "profile_exists" ||
    problem?.code === "profile_not_found"
  ) {
    return {
      ...(problem.currentVersion === undefined
        ? {}
        : { currentVersion: problem.currentVersion }),
      kind: "conflict",
    };
  }
  return {
    kind: "unavailable",
    reference: problem?.correlationId ?? problem?.code ?? "profile-response",
  };
}

function unavailable(
  error: unknown,
): Extract<ProfileMutationState, { readonly kind: "unavailable" }> {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError ? error.code : "profile-contract",
  };
}

function emptyToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function hasRejectedControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      ((codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127)
    );
  });
}
