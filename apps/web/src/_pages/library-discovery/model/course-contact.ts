import type { ProductPage } from "@/entities/product-page";

/** Правило Telegram для ника: 5–32 символа, латиница, цифры и подчёркивание. */
const telegramHandlePattern = /@([A-Za-z][A-Za-z0-9_]{4,31})/u;

/**
 * Подпись автора с ником Telegram: ник хранится в описании курса, а не в коде, и в тексте не
 * печатается, его заменяет кнопка (решение владельца 09.10.2026).
 */
export function splitTelegramNote(note: string): {
  readonly text: string;
  readonly handle: string | undefined;
} {
  const handle = telegramHandlePattern.exec(note)?.[1];
  return {
    text: handle === undefined ? note : note.replace(`@${handle}`, "").trim(),
    handle,
  };
}

/**
 * Ник автора для связи со страницы курса: тот же, что в подписи блока частых вопросов. Билет с
 * ценой зовёт написать на него, а второго места для ника в описании нет.
 */
export function courseTelegramHandle(
  page: ProductPage | null,
): string | undefined {
  const faq = page?.blocks.find(
    (block) => block.kind === "cards" && block.id === "faq",
  );
  return faq?.kind === "cards" ? splitTelegramNote(faq.note).handle : undefined;
}
