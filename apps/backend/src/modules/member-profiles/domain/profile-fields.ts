import type {
  MemberProfileFields,
  ProfileValidationIssue,
} from "../facets/member-profiles/member-profiles.interface.js";

export type MemberProfileFieldsInput = Readonly<{
  displayName: unknown;
  bio: unknown;
}>;

export type AcceptedMemberProfileFields =
  | Readonly<{ ok: true; fields: MemberProfileFields }>
  | Readonly<{ ok: false; issues: readonly ProfileValidationIssue[] }>;

export function acceptMemberProfileFields(
  input: MemberProfileFieldsInput,
): AcceptedMemberProfileFields {
  const issues: ProfileValidationIssue[] = [];
  const displayName = normalizeDisplayName(input.displayName);
  const bio = normalizeBio(input.bio);

  if (displayName === null) {
    issues.push({ field: "displayName", code: "required" });
  } else {
    const length = unicodeLength(displayName);
    if (length < 2) issues.push({ field: "displayName", code: "too_short" });
    if (length > 80) issues.push({ field: "displayName", code: "too_long" });
    if (hasForbiddenControlCharacters(displayName)) {
      issues.push({ field: "displayName", code: "invalid_characters" });
    }
  }

  if (bio !== null) {
    if (unicodeLength(bio) > 500) {
      issues.push({ field: "bio", code: "too_long" });
    }
    if (hasForbiddenControlCharacters(bio)) {
      issues.push({ field: "bio", code: "invalid_characters" });
    }
  }

  return issues.length > 0 || displayName === null
    ? { ok: false, issues }
    : { ok: true, fields: { displayName, bio } };
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length === 0 ? null : normalized;
}

function normalizeBio(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "\u0000";
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return normalized.length === 0 ? null : normalized;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function hasForbiddenControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      ((codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        (codePoint >= 127 && codePoint <= 159))
    );
  });
}
