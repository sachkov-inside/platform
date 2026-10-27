import type { ReasonOption } from "@/shared/ui/admin";

/**
 * Причины действий с доступом: выдача одному человеку в его карточке (#1721), выдача нескольким
 * людям на вкладке «Ученики» продукта (#1718), отзыв и восстановление. Product Access хранит
 * причину текстом и показывает её в истории как есть, поэтому выбор кодируется в текст здесь,
 * один раз для всех этих действий: `"<подпись>"`,
 * `"<подпись>: <заметка>"`, если владелец дописал необязательную заметку, или
 * `"Другое: <заметка>"`. Правила доступа причину не читают.
 */

/** Вариант, при котором заметка обязательна и становится частью текста. */
export const otherReason = "Другое";

/** Самая длинная причина, которую принимает Product Access. */
export const ACCESS_REASON_MAX_CHARACTERS = 1000;

const revokeReasonLabels = [
  "Возврат оплаты",
  "Нарушение правил",
  "Выдано по ошибке",
  "По просьбе человека",
  otherReason,
] as const;

const grantReasonLabels = [
  "Подарок",
  "Компенсация или решение поддержки",
  "Оплата вне сайта",
  "Перенос оплаты",
  "Команда и партнёры",
  otherReason,
] as const;

function options(labels: readonly string[]): readonly ReasonOption[] {
  return labels.map((label) => ({ label, value: label }));
}

export const revokeReasons: readonly ReasonOption[] =
  options(revokeReasonLabels);
export const grantReasons: readonly ReasonOption[] = options(grantReasonLabels);

/** Сколько знаков остаётся заметке после самой длинной подписи, чтобы текст уместился в предел. */
export function reasonNoteMaxCharacters(
  choices: readonly ReasonOption[],
): number {
  const longest = Math.max(...choices.map((option) => option.label.length));
  return ACCESS_REASON_MAX_CHARACTERS - longest - ": ".length;
}

export type AccessReasonResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly error: "reason_required" | "note_required" | "too_long";
    };

/**
 * Текст причины из выбора и заметки. Причина из списка обязательна; заметка к ней необязательна и
 * дописывается через двоеточие. «Другое» без заметки не принимается. Пробелы по краям и подряд
 * схлопываются, чтобы история не хранила случайные переносы.
 */
export function encodeAccessReason(
  choices: readonly ReasonOption[],
  input: { readonly reason: string; readonly note: string },
): AccessReasonResult {
  const choice = choices.find((option) => option.value === input.reason);
  if (choice === undefined) return { ok: false, error: "reason_required" };
  const note = input.note.trim().replace(/\s+/gu, " ");
  if (note === "")
    return choice.value === otherReason
      ? { ok: false, error: "note_required" }
      : { ok: true, text: choice.label };
  const text = `${choice.label}: ${note}`;
  return text.length > ACCESS_REASON_MAX_CHARACTERS
    ? { ok: false, error: "too_long" }
    : { ok: true, text };
}

/** Причина восстановления: свободный текст, обязательный и не длиннее предела. */
export function encodeRestoreReason(note: string): AccessReasonResult {
  const text = note.trim().replace(/\s+/gu, " ");
  if (text === "") return { ok: false, error: "note_required" };
  return text.length > ACCESS_REASON_MAX_CHARACTERS
    ? { ok: false, error: "too_long" }
    : { ok: true, text };
}
