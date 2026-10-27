"use client";

import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import type { PaymentProduct } from "../model/payment-contract";

import "./owner-payments.css";

/** Сколько подсказок видно сразу; остальные находятся вводом названия. */
const shownChoices = 20;

export type ProductChoices =
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly items: readonly PaymentProduct[] };

/** Название выбранного продукта, пока список продуктов не пришёл или его в списке нет. */
export function productChoiceLabel(
  productId: string,
  choices: ProductChoices,
): string {
  return choices.kind === "ready"
    ? (choices.items.find((item) => item.id === productId)?.name ??
        "Выбранный продукт")
    : "Выбранный продукт";
}

interface Option {
  readonly id: string | undefined;
  readonly label: string;
}

/**
 * Продукт фильтра по названию: поле с подсказками (ARIA combobox). Видно не больше двадцати
 * подсказок, весь список доступен вводом. Идентификатор продукта человек не вводит и не видит.
 */
export function ProductFilter({
  choices,
  value,
  onChange,
}: {
  readonly choices: ProductChoices;
  readonly value: string | undefined;
  readonly onChange: (productId: string | undefined) => void;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const chosenLabel =
    value === undefined ? "" : productChoiceLabel(value, choices);
  const shownText = text ?? chosenLabel;
  const needle = (text ?? "").trim().toLocaleLowerCase("ru");
  const items = choices.kind === "ready" ? choices.items : [];
  const matching = items.filter((item) =>
    item.name.toLocaleLowerCase("ru").includes(needle),
  );
  const options: Option[] = [
    { id: undefined, label: "Все продукты" },
    ...matching
      .slice(0, shownChoices)
      .map((item) => ({ id: item.id, label: item.name })),
  ];
  const hidden = matching.length - shownChoices;
  const expanded = open && choices.kind === "ready";
  const activeIndex = Math.min(active, options.length - 1);

  const close = () => {
    setOpen(false);
    setText(null);
    setActive(0);
  };
  const choose = (option: Option) => {
    close();
    if (option.id !== value) onChange(option.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (choices.kind !== "ready") return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((activeIndex + 1) % options.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((activeIndex - 1 + options.length) % options.length);
        return;
      case "Enter": {
        if (!open) return;
        event.preventDefault();
        const option = options[activeIndex];
        if (option !== undefined) choose(option);
        return;
      }
      case "Escape":
        if (!open && text === null) return;
        event.preventDefault();
        close();
        return;
    }
  };

  const hint =
    choices.kind === "unavailable"
      ? "Список продуктов не загрузился. Остальные фильтры работают."
      : choices.kind === "pending"
        ? "Загружаем продукты…"
        : undefined;

  return (
    <div className="admin-field owner-payments-product">
      <label className="admin-field-label" htmlFor={inputId}>
        Продукт
      </label>
      <div className="owner-payments-product-control">
        <input
          aria-activedescendant={
            expanded ? `${listId}-${String(activeIndex)}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={hint === undefined ? undefined : hintId}
          aria-expanded={expanded}
          autoComplete="off"
          className="admin-field-input"
          disabled={choices.kind !== "ready" && value === undefined}
          id={inputId}
          onBlur={close}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setOpen(true);
            setActive(0);
          }}
          onClick={() => {
            if (choices.kind === "ready") setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Все продукты"
          role="combobox"
          type="text"
          value={shownText}
        />
        {value === undefined ? null : (
          <button
            aria-label={`Убрать продукт «${chosenLabel}»`}
            className="owner-payments-product-clear"
            onClick={() => {
              close();
              onChange(undefined);
              document.getElementById(inputId)?.focus();
            }}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {hint === undefined ? null : (
        <p className="admin-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      <ul
        aria-label="Продукты"
        className="owner-payments-product-list"
        hidden={!expanded}
        id={listId}
        role="listbox"
      >
        {options.map((option, index) => (
          <li
            aria-selected={option.id === value}
            className="owner-payments-product-option"
            data-active={index === activeIndex ? "" : undefined}
            id={`${listId}-${String(index)}`}
            key={option.id ?? "all"}
            onMouseDown={(event) => {
              // Поле не теряет фокус до выбора: иначе список закрылся бы раньше щелчка.
              event.preventDefault();
            }}
            onClick={() => {
              choose(option);
            }}
            onMouseMove={() => {
              if (index !== activeIndex) setActive(index);
            }}
            role="option"
          >
            {option.label}
          </li>
        ))}
        {matching.length === 0 ? (
          <li className="owner-payments-product-note" role="presentation">
            Продукт с таким названием не найден
          </li>
        ) : hidden > 0 ? (
          <li className="owner-payments-product-note" role="presentation">
            Ещё {hidden}. Уточните название, чтобы их увидеть.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
