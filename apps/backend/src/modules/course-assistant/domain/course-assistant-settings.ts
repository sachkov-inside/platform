/**
 * Включение прототипа помощника курса (#786). Помощник выключен по умолчанию и открывается только
 * Account из allowlist; production его не включает.
 */
export interface CourseAssistantSettings {
  readonly enabled: boolean;
  /** Account ID в нижнем регистре. */
  readonly accountAllowlist: readonly string[];
}

export function admitsParticipant(
  settings: CourseAssistantSettings,
  accountId: string,
): boolean {
  return (
    settings.enabled &&
    settings.accountAllowlist.includes(accountId.toLowerCase())
  );
}
