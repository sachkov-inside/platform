import { z } from "zod";

import { hasText } from "@/shared/lib/text";

/**
 * Как владелец видит человека (#1721): имя и @username связанного Telegram, email из Billing
 * Contact. Имя профиля сюда не входит: политика персональных данных обещает, что профиль виден
 * только самому человеку. ID аккаунта служит ключом и показывается мелко, никогда как название.
 */
export const personIdentitySchema = z
  .object({
    accountId: z.uuid(),
    displayName: z.string().nullable(),
    username: z.string().nullable(),
    email: z.string().nullable(),
  })
  .strict();

export type PersonIdentity = z.infer<typeof personIdentitySchema>;

/** Подписи человека: заголовок и строка контекста из оставшихся фактов. */
export interface PersonLabel {
  /** Имя Telegram, иначе @username, иначе email; `null`, если у человека нет ни одного из них. */
  readonly title: string | null;
  readonly context: readonly string[];
}

/** Порядок решения владельца 5: имя, затем @username, затем email. */
export function personLabel(identity: PersonIdentity): PersonLabel {
  const facts = [
    identity.displayName,
    hasText(identity.username) ? `@${identity.username}` : null,
    identity.email,
  ].filter((fact): fact is string => hasText(fact));
  return { title: facts[0] ?? null, context: facts.slice(1) };
}

/** Сокращённый ID для подписи: первые восемь знаков, полный ID копируется кнопкой. */
export function shortAccountId(accountId: string): string {
  return accountId.slice(0, 8);
}
