import { HttpException, HttpStatus } from "@nestjs/common";
import type { z } from "zod";

import type { MemberProfileError } from "../../facets/member-profiles/member-profiles.interface.js";

export function parseProfileBody<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpException(
      {
        type: "urn:inside:problem:member-profile-invalid-input",
        title: "Profile input is invalid",
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        detail: "Profile request body does not match the accepted contract.",
        code: "invalid_input",
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return result.data;
}

export function throwProfileHttpError(error: MemberProfileError): never {
  const statusByCode: Readonly<Record<MemberProfileError["code"], HttpStatus>> = {
    invalid_input: HttpStatus.UNPROCESSABLE_ENTITY,
    profile_exists: HttpStatus.CONFLICT,
    profile_not_found: HttpStatus.NOT_FOUND,
    conflict: HttpStatus.CONFLICT,
    internal_error: HttpStatus.INTERNAL_SERVER_ERROR,
  };
  const status = statusByCode[error.code];
  throw new HttpException(
    {
      type: `urn:inside:problem:member-profile-${error.code.replaceAll("_", "-")}`,
      title: titleFor(error.code),
      status,
      detail: detailFor(error.code),
      code: error.code,
      ...(error.code === "invalid_input" ? { issues: error.issues } : {}),
      ...(error.code === "conflict" && error.currentVersion !== undefined
        ? { currentVersion: error.currentVersion }
        : {}),
      ...(error.code === "internal_error"
        ? { correlationId: error.correlationId }
        : {}),
    },
    status,
  );
}

export function throwMemberProfileNotFound(): never {
  throwProfileHttpError({ code: "profile_not_found" });
}

function titleFor(code: MemberProfileError["code"]): string {
  if (code === "invalid_input") return "Profile input is invalid";
  if (code === "profile_exists") return "Profile already exists";
  if (code === "profile_not_found") return "Profile not found";
  if (code === "conflict") return "Profile changed concurrently";
  return "Profile operation failed";
}

function detailFor(code: MemberProfileError["code"]): string {
  if (code === "invalid_input") return "Profile fields do not satisfy the accepted contract.";
  if (code === "profile_exists") return "This Account already has a Profile.";
  if (code === "profile_not_found") return "The requested Profile is not available.";
  if (code === "conflict") return "Reload the Profile before saving or deleting it.";
  return "The Profile request could not be completed.";
}
