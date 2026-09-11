"use client";

/**
 * Ожидаемая ошибка чтения объясняется словами. Кнопки обновления рядом нет: платформа
 * перечитывает состояние сама, а повтор здесь безопасен.
 */
export function BillingSectionError({ error }: { readonly error: string | undefined }) {
  if (error === undefined) return null;
  return (
    <p
      className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
      role="alert"
    >
      {error}
    </p>
  );
}
