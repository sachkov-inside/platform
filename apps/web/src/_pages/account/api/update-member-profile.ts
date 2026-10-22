import "server-only";

import type { z } from "zod";

import { updateMemberProfileInputSchema } from "@/features/member-profile-editor.operations";

import { parseMemberProfileProblem } from "@/entities/member-profile";
import {
  BackendConnectionError,
  requestMemberProfileUpdate,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { UpdateMemberProfileResult } from "../model/update-member-profile";
import {
  parsePrivateProfile,
  profileIssueMessage,
} from "@/entities/member-profile";

export async function executeUpdateMemberProfile(
  input: z.output<typeof updateMemberProfileInputSchema>,
  accessToken: string,
  request: typeof requestMemberProfileUpdate = requestMemberProfileUpdate,
): Promise<UpdateMemberProfileResult> {
  let result: BackendTransportResult;
  try {
    result = await request(
      {
        bio: emptyToNull(input.bio),
        displayName: input.displayName.trim(),
        expectedVersion: input.expectedVersion,
      },
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
  return mapUpdateProfileProblem(result);
}

function mapUpdateProfileProblem(
  result: Extract<BackendTransportResult, { readonly ok: false }>,
): UpdateMemberProfileResult {
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
  if (problem?.code === "conflict" || problem?.code === "profile_not_found") {
    return {
      ...(problem.currentVersion === undefined
        ? {}
        : { currentVersion: problem.currentVersion }),
      kind: "conflict",
    };
  }
  return {
    kind: "unavailable",
    reference:
      problem?.correlationId ?? problem?.code ?? "update-profile-response",
  };
}

export function invalidUpdateProfileFields(
  error: z.ZodError,
): UpdateMemberProfileResult {
  const fields = new Set(error.issues.map((issue) => issue.path[0]));
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

function unavailable(error: unknown): UpdateMemberProfileResult {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError
        ? error.code
        : "update-profile-contract",
  };
}

function emptyToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}
