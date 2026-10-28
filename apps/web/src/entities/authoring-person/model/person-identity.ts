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
    /** `partial`: часть фактов сейчас не прочиталась, пустое поле тогда неизвестно, а не пусто. */
    contactsState: z.enum(["complete", "partial"]),
  })
  .strict();

export type PersonIdentity = z.infer<typeof personIdentitySchema>;

/** Подписи человека: заголовок и строка контекста из оставшихся фактов. */
export interface PersonLabel {
  /** Имя Telegram, иначе @username, иначе email; `null`, если ни одного из них не известно. */
  readonly title: string | null;
  /** Чего нет в заголовке: «Без имени и email» или «Контакты временно недоступны». */
  readonly missing: string;
  readonly context: readonly string[];
}

/** Порядок решения владельца 5: имя, затем @username, затем email. */
export function personLabel(identity: PersonIdentity): PersonLabel {
  const facts = [
    identity.displayName,
    hasText(identity.username) ? `@${identity.username}` : null,
    identity.email,
  ].filter((fact): fact is string => hasText(fact));
  return {
    title: facts[0] ?? null,
    context: facts.slice(1),
    missing:
      identity.contactsState === "partial"
        ? "Контакты временно недоступны"
        : "Без имени и email",
  };
}

/** Сокращённый ID для подписи: первые восемь знаков, полный ID копируется кнопкой. */
export function shortAccountId(accountId: string): string {
  return accountId.slice(0, 8);
}
