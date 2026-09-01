import "server-only";

import { z } from "zod";

import { parseMemberProfileProblem } from "@/entities/member-profile";
import {
  BackendConnectionError,
  requestMemberProfileCreation,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { CreateMemberProfileResult } from "../model/create-member-profile";
import {
  parsePrivateProfile,
  profileIssueMessage,
} from "./member-profile-contract";

const textField = z.string().refine((value) => !hasRejectedControlCharacters(value));
const formSchema = z
  .object({
    bio: textField.refine((value) => codePointLength(value) <= 500),
    displayName: textField.refine((value) => {
      const length = codePointLength(value.trim());
      return length >= 2 && length <= 80;
    }),
  })
  .strict();

export async function executeCreateMemberProfile(
  formData: FormData,
  accessToken: string,
  request: typeof requestMemberProfileCreation = requestMemberProfileCreation,
): Promise<CreateMemberProfileResult> {
  const parsed = formSchema.safeParse({
    bio: formData.get("bio"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) return invalidProfileFields(parsed.error);

  let result: BackendTransportResult;
  try {
    result = await request(
      {
        bio: emptyToNull(parsed.data.bio),
        displayName: parsed.data.displayName.trim(),
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
): CreateMemberProfileResult {
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
    reference: problem?.correlationId ?? problem?.code ?? "create-profile-response",
  };
}

function invalidProfileFields(error: z.ZodError): CreateMemberProfileResult {
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

function unavailable(error: unknown): CreateMemberProfileResult {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError ? error.code : "create-profile-contract",
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
