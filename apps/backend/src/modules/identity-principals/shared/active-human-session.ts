export function activeHumanSessionError(value:
  | {
      readonly kind: string;
      readonly state: string;
      readonly expiresAt: Date;
      readonly endedAt: Date | null;
    }
  | undefined):
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "principal_disabled"
          | "session_ended"
          | "session_expired"
          | "session_not_found";
      };
    }
  | undefined {
  if (value === undefined || value.kind !== "human") {
    return { ok: false, error: { code: "session_not_found" } };
  }
  if (value.state === "disabled") {
    return { ok: false, error: { code: "principal_disabled" } };
  }
  if (value.endedAt !== null) {
    return { ok: false, error: { code: "session_ended" } };
  }
  if (value.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: { code: "session_expired" } };
  }
  return undefined;
}
