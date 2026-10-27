"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { usePeopleSearch } from "../model/use-people-reads.client";
import { personLabel, type PersonIdentity } from "../model/person-identity";
import { CopyAccountId } from "./copy-account-id.client";

/** Пауза ввода перед запросом: поиск не уходит на каждую букву. */
const SEARCH_INPUT_PAUSE_MS = 250;

export interface PeopleSearchComboboxProps {
  readonly label: string;
  readonly value: PersonIdentity | null;
  readonly onChange: (person: PersonIdentity | null) => void;
  readonly limit?: number;
}

/**
 * Выбор одного человека поиском по имени и @username Telegram, точному email или ID (#1721).
 * Список подсказок построен по образцу combobox ARIA: стрелки двигают выделение, Enter выбирает,
 * Escape закрывает. Недоступный поиск по имени назван прямо, а не показан пустым ответом.
 */
export function PeopleSearchCombobox({
  label,
  value,
  onChange,
  limit = 8,
}: PeopleSearchComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text);
    }, SEARCH_INPUT_PAUSE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const searched = usePeopleSearch(query, { limit });
  // Until the paused input reaches the query, the previous answer is not offered: Enter could
  // otherwise choose a person from the text before the last edit.
  const pending = text.trim() !== query.trim() && text.trim() !== "";
  const search: typeof searched = pending ? { kind: "loading" } : searched;
  const items = search.kind === "ready" ? search.items : [];
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  if (value !== null) {
    const chosen = personLabel(value);
    return (
      <div className="grid min-w-0 gap-2">
        <span className="text-sm font-semibold" id={`${id}-label`}>
          {label}
        </span>
        <div
          className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-input bg-card px-3 py-2"
          aria-labelledby={`${id}-label`}
          role="group"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">
              {chosen.title ?? chosen.missing}
            </span>
            {chosen.context.length > 0 ? (
              <span className="truncate text-sm text-muted-foreground">
                {chosen.context.join(" · ")}
              </span>
            ) : null}
            <CopyAccountId accountId={value.accountId} />
          </span>
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted"
            onClick={() => {
              onChange(null);
              setText("");
              setQuery("");
            }}
          >
            <X aria-hidden="true" className="size-4" />
            Изменить
          </button>
        </div>
      </div>
    );
  }

  const choose = (person: PersonIdentity) => {
    onChange(person);
    setOpen(false);
  };
  const showList = open && search.kind !== "idle";

  return (
    <div className="relative grid min-w-0 gap-2">
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id={id}
          className="min-h-11 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-sm"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={
            showList && items.length > 0
              ? `${listId}-${String(activeIndex)}`
              : undefined
          }
          aria-describedby={`${id}-hint`}
          placeholder="Имя, @username, email или ID"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive(Math.min(activeIndex + 1, items.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(activeIndex - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const person = items[activeIndex];
              if (showList && person !== undefined) choose(person);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground" id={`${id}-hint`}>
        Email ищется только целиком.
      </p>
      {showList ? (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="m-0 list-none p-0"
          >
            {items.map((person, index) => {
              const option = personLabel(person);
              return (
                <li
                  key={person.accountId}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className="flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5 aria-selected:bg-muted"
                  onMouseDown={(event) => {
                    // The input keeps focus until the choice is made.
                    event.preventDefault();
                  }}
                  onClick={() => {
                    choose(person);
                  }}
                  onMouseEnter={() => {
                    setActive(index);
                  }}
                >
                  <span className="truncate text-sm font-medium">
                    {option.title ?? option.missing}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[
                      ...option.context,
                      `ID ${person.accountId.slice(0, 8)}`,
                    ].join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
          <p
            role="status"
            className="m-0 px-3 py-2 text-sm text-muted-foreground empty:hidden"
          >
            {searchMessage(search)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function searchMessage(search: ReturnType<typeof usePeopleSearch>): string {
  switch (search.kind) {
    case "idle":
      return "";
    case "loading":
      return "Ищем…";
    case "ready":
      if (search.nameSearch === "unavailable")
        return "Поиск по имени временно недоступен. Найдите человека по email или ID.";
      return search.items.length === 0 ? "Никого не нашли." : "";
    case "signed_out":
      return "Сессия закончилась. Войдите снова.";
    case "forbidden":
      return "Нет права искать людей.";
    case "unavailable":
      return "Поиск не ответил. Повторите позже.";
  }
}
