import { HttpStatus } from "@nestjs/common";
import type { z } from "zod";

import { problemException } from "../../../../infrastructure/http/problem-details.js";

import type { MemberProfileError } from "../../facets/member-profiles/member-profiles.interface.js";

export function parseProfileBody<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw problemException(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_input", "Profile input is invalid", {
      detail: "Profile request body does not match the accepted contract.",
    });
  }
  return result.data;
}

export function throwProfileHttpError(error: MemberProfileError): never {
  const metadata = errorMetadata[error.code];
  throw problemException(metadata.status, error.code, metadata.title, {
    detail: metadata.detail,
    ...(error.code === "invalid_input" ? { issues: error.issues } : {}),
    ...(error.code === "conflict" && error.currentVersion !== undefined
      ? { currentVersion: error.currentVersion }
      : {}),
    ...(error.code === "internal_error"
      ? { correlationId: error.correlationId }
      : {}),
  });
}

export function throwMemberProfileNotFound(): never {
  throwProfileHttpError({ code: "profile_not_found" });
}

const errorMetadata = {
  invalid_input: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    title: "Profile input is invalid",
    detail: "Profile fields do not satisfy the accepted contract.",
  },
  profile_exists: {
    status: HttpStatus.CONFLICT,
    title: "Profile already exists",
    detail: "This Account already has a Profile.",
  },
  profile_not_found: {
    status: HttpStatus.NOT_FOUND,
    title: "Profile not found",
    detail: "The requested Profile is not available.",
  },
  conflict: {
    status: HttpStatus.CONFLICT,
    title: "Profile changed concurrently",
    detail: "Reload the Profile before saving it.",
  },
  internal_error: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    title: "Profile operation failed",
    detail: "The Profile request could not be completed.",
  },
} as const satisfies Readonly<
  Record<
    MemberProfileError["code"],
    Readonly<{ status: HttpStatus; title: string; detail: string }>
  >
>;
