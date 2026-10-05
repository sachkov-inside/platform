/**
 * Ключи кэша раздела «Доступ». Команда одной вкладки сбрасывает ключи всех вкладок, которые
 * показывают изменённый факт: сводка считает людей, приглашения и основания.
 */
export const invitationsQueryKey = ["access-invitations"] as const;
export const peopleQueryKey = ["access-people"] as const;
export const accessSummaryQueryKey = ["access-summary"] as const;
