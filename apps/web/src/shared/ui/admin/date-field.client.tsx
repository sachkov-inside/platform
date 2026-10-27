"use client";

import { CircleAlert } from "lucide-react";
import { useId, useState } from "react";

import { formatMoscowDate } from "@/shared/lib/moscow-format";
import { hasText } from "@/shared/lib/text";

import "./admin.css";

export interface DateFieldProps {
  readonly label: string;
  /** «YYYY-MM-DD» или пустая строка. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Границы «YYYY-MM-DD». */
  readonly min?: string;
  readonly max?: string;
  readonly name?: string;
  readonly required?: boolean;
  /** Видимая подсказка формата. */
  readonly hint?: string;
  /** Ошибка от формы или сервера; она важнее собственной проверки поля. */
  readonly error?: string;
}

/**
 * Поле даты: штатный календарь браузера и ввод с клавиатуры. Формат назван видимой подсказкой, а
 * не только заполнителем. Собственная проверка показывается после того, как человек покинул поле.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  name,
  required = false,
  hint = "ДД.ММ.ГГГГ",
  error,
}: DateFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // Проверка включается уходом из поля; видимая ошибка перепроверяется при вводе.
  const [left, setLeft] = useState(false);
  // Браузер отдаёт пустое значение и для пустого поля, и для недописанной даты; различает их
  // только `validity.badInput`.
  const [incomplete, setIncomplete] = useState(false);

  const ownError = left
    ? dateError(value, { incomplete, min, max, required })
    : null;
  const shownError = hasText(error) ? error : ownError;
  const describedBy = [
    hasText(hint) ? hintId : null,
    shownError === null ? null : errorId,
  ]
    .filter((part) => part !== null)
    .join(" ");

  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={shownError !== null}
        className="admin-field-input"
        id={id}
        max={max}
        min={min}
        name={name}
        onBlur={(event) => {
          setLeft(true);
          setIncomplete(event.currentTarget.validity.badInput);
        }}
        onChange={(event) => {
          if (ownError === null) setLeft(false);
          setIncomplete(event.currentTarget.validity.badInput);
          onChange(event.currentTarget.value);
        }}
        required={required}
        type="date"
        value={value}
      />
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

function dateError(
  value: string,
  {
    incomplete,
    min,
    max,
    required,
  }: {
    readonly incomplete: boolean;
    readonly min: string | undefined;
    readonly max: string | undefined;
    readonly required: boolean;
  },
): string | null {
  if (incomplete) return "Введите дату полностью: день, месяц и год";
  if (value === "") return required ? "Укажите дату" : null;
  if (hasText(min) && value < min)
    return `Дата не может быть раньше ${formatMoscowDate(min)}`;
  if (hasText(max) && value > max)
    return `Дата не может быть позже ${formatMoscowDate(max)}`;
  return null;
}
