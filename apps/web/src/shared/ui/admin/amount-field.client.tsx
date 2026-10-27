"use client";

import { CircleAlert } from "lucide-react";
import { useId, useState } from "react";

import {
  formatRublesInput,
  parseRublesInput,
} from "@/shared/lib/moscow-format";
import { hasText } from "@/shared/lib/text";

import { amountError } from "./amount-validation";

import "./admin.css";

export interface AmountFieldProps {
  /** Подпись по смыслу: «Цена», «Сумма скидки». Единица «₽» добавляется к доступному имени сама. */
  readonly label: string;
  /** Имя скрытого поля с целыми копейками для обычной формы. */
  readonly name?: string;
  readonly valueKopecks: number | null;
  /** Целые копейки; `null`: поле пустое или текст не читается как сумма. */
  readonly onChange: (kopecks: number | null) => void;
  /** Границы в копейках. */
  readonly min?: number;
  readonly max?: number;
  readonly required?: boolean;
  readonly hint?: string;
  /** Ошибка от формы или сервера; она важнее собственной проверки поля. */
  readonly error?: string;
}

/**
 * Поле суммы в рублях: знак «₽» стоит за полем, ввод принимает «4 990», «1 234,50» и набранный
 * «₽». Хранится целое число копеек. Собственная проверка показывается только после того, как
 * человек покинул поле; при уходе из поля верная сумма переписывается в обычном виде.
 */
export function AmountField({
  label,
  name,
  valueKopecks,
  onChange,
  min,
  max,
  required = false,
  hint,
  error,
}: AmountFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // Текст, пока человек его правит; `null`: показывается сумма из `valueKopecks`.
  const [draft, setDraft] = useState<string | null>(null);
  // Проверка включается уходом из поля. Пока ошибка видна, поле перепроверяется при вводе; без
  // ошибки новая правка снова ждёт ухода из поля, чтобы не ругать недописанную сумму.
  const [left, setLeft] = useState(false);

  const text =
    draft ?? (valueKopecks === null ? "" : formatRublesInput(valueKopecks));
  const ownError = left ? amountError(text, { min, max, required }) : null;
  const shownError = presentError(error) ?? ownError;
  const describedBy = [
    hasText(hint) ? hintId : null,
    shownError === null ? null : errorId,
  ]
    .filter((value) => value !== null)
    .join(" ");

  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">{`${label}, ₽`}</span>
      </label>
      <div className="admin-field-control">
        <input
          aria-describedby={describedBy === "" ? undefined : describedBy}
          aria-invalid={shownError !== null}
          autoComplete="off"
          className="admin-field-input"
          id={id}
          inputMode="decimal"
          onBlur={() => {
            setLeft(true);
            if (text.trim() === "" || parseRublesInput(text) !== null)
              setDraft(null);
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (ownError === null) setLeft(false);
            setDraft(next);
            onChange(parseRublesInput(next));
          }}
          required={required}
          type="text"
          value={text}
        />
        <span aria-hidden="true" className="admin-field-suffix">
          ₽
        </span>
      </div>
      {name === undefined ? null : (
        <input
          name={name}
          type="hidden"
          value={valueKopecks === null ? "" : String(valueKopecks)}
        />
      )}
      {hasText(hint) ? (
        <p className="admin-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {shownError === null ? null : (
        <p className="admin-field-error" id={errorId}>
          <CircleAlert aria-hidden="true" />
          {shownError}
        </p>
      )}
    </div>
  );
}

function presentError(error: string | undefined): string | null {
  return hasText(error) ? error : null;
}
