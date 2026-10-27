import "server-only";

import type { z } from "zod";

import type { createAccountProfileInputSchema } from "@/features/account-profile-editor.operations";

import { parseAccountProfileProblem } from "@/entities/account-profile";
import {
  BackendConnectionError,
  requestAccountProfileCreation,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { CreateAccountProfileResult } from "../model/create-account-profile";
import {
  parsePrivateProfile,
  profileIssueMessage,
} from "@/entities/account-profile";

export async function executeCreateAccountProfile(
  input: z.output<typeof createAccountProfileInputSchema>,
  accessToken: string,
  request: typeof requestAccountProfileCreation = requestAccountProfileCreation,
): Promise<CreateAccountProfileResult> {
  let result: BackendTransportResult;
  try {
    result = await request(
      {
        bio: emptyToNull(input.bio),
        displayName: input.displayName.trim(),
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
  return mapCreateProfileProblem(result);
}

function mapCreateProfileProblem(
  result: Extract<BackendTransportResult, { readonly ok: false }>,
): CreateAccountProfileResult {
  if (result.response.status === 401) return { kind: "unauthorized" };
  const problem = parseAccountProfileProblem(result.problem);
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
  if (problem?.code === "profile_exists") {
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
      problem?.correlationId ?? problem?.code ?? "create-profile-response",
  };
}

export function invalidCreateProfileFields(
  error: z.ZodError,
): CreateAccountProfileResult {
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

function unavailable(error: unknown): CreateAccountProfileResult {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError
        ? error.code
        : "create-profile-contract",
  };
}

function emptyToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}
