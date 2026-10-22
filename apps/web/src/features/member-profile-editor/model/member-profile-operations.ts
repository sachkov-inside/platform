import { z } from "zod";

import { parsePrivateProfile } from "@/entities/member-profile";

import type { CreateMemberProfileResult } from "./create-member-profile";

const textField = z
  .string()
  .refine((value) => !hasRejectedControlCharacters(value));
const bioField = textField.refine((value) => codePointLength(value) <= 500);
const displayNameField = textField.refine((value) => {
  const length = codePointLength(value.trim());
  return length >= 2 && length <= 80;
});

/** The fields a new member profile starts from. */
export const createMemberProfileInputSchema = z.object({
  bio: bioField,
  displayName: displayNameField,
});

/** The fields that replace a member profile at its expected version. */
export const updateMemberProfileInputSchema = z.object({
  bio: bioField,
  displayName: displayNameField,
  expectedVersion: z.number().int().positive(),
});

/**
 * The Route Handler's answer to a profile write. A saved profile is parsed by its own entity
 * contract; one that does not parse is a contract failure.
 */
export const memberProfileResultSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("saved"), profile: z.unknown() }).strict(),
    z
      .object({
        fieldErrors: z
          .object({
            bio: z.string().optional(),
            displayName: z.string().optional(),
          })
          .strict(),
        kind: z.literal("invalid_input"),
      })
      .strict(),
    z
      .object({
        currentVersion: z.number().int().positive().optional(),
        kind: z.literal("conflict"),
      })
      .strict(),
    z.object({ kind: z.literal("unauthorized") }).strict(),
    z
      .object({ kind: z.literal("unavailable"), reference: z.string() })
      .strict(),
  ])
  .transform((result, context): CreateMemberProfileResult => {
    if (result.kind === "saved") {
      try {
        return {
          kind: "saved",
          profile: parsePrivateProfile({ profile: result.profile }),
        };
      } catch {
        context.addIssue({ code: "custom", message: "Malformed profile" });
        return z.NEVER;
      }
    }
    if (result.kind === "invalid_input") {
      return {
        fieldErrors: {
          ...(result.fieldErrors.bio === undefined
            ? {}
            : { bio: result.fieldErrors.bio }),
          ...(result.fieldErrors.displayName === undefined
            ? {}
            : { displayName: result.fieldErrors.displayName }),
        },
        kind: "invalid_input",
      };
    }
    if (result.kind !== "conflict") return result;
    return result.currentVersion === undefined
      ? { kind: "conflict" }
      : { currentVersion: result.currentVersion, kind: "conflict" };
  });

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
