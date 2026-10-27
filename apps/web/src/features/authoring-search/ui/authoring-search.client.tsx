"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";

import { requestAuthoringSearch } from "../api/authoring-search.browser";
import {
  authoringSearchQueryKey,
  authoringSearchQuerySchema,
  searchGroupEntries,
  searchGroupNote,
  searchGroupPresentation,
  type AuthoringSearchEntry,
  type AuthoringSearchState,
} from "../model/authoring-search";
import "./authoring-search.css";

const SearchContext = createContext<(() => void) | null>(null);

/** The user agent does not change while the page lives. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/**
 * Окно общего поиска админки и сочетание `⌘K`/`Ctrl+K`. Окно одно на каркас; кнопки
 * `AuthoringSearchTrigger` внутри открывают его.
 */
export function AuthoringSearchRoot({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  const openSearch = useCallback(() => {
    setOpen(true);
  }, []);
  return (
    <SearchContext.Provider value={openSearch}>
      {children}
      <AuthoringSearchDialog
        onClose={() => {
          setOpen(false);
        }}
        open={open}
      />
    </SearchContext.Provider>
  );
}

/**
 * Поле поиска в каркасе. От 64rem оно выглядит строкой ввода с подсказкой сочетания, на телефоне
 * остаётся кнопкой со значком.
 */
export function AuthoringSearchTrigger() {
  const openSearch = useContext(SearchContext);
  // The platform is a browser fact: the server render and hydration assume «Ctrl K».
  const shortcut = useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/u.test(navigator.userAgent) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
  return (
    <button
      aria-keyshortcuts="Meta+K Control+K"
      aria-label="Поиск по админке"
      className="authoring-search-trigger"
      disabled={openSearch === null}
      onClick={() => {
        openSearch?.();
      }}
      type="button"
    >
      <Search aria-hidden="true" className="authoring-search-trigger-icon" />
      <span className="authoring-search-trigger-text">
        Поиск по продуктам и материалам
      </span>
      <kbd aria-hidden="true" className="authoring-search-trigger-kbd">
        {shortcut}
      </kbd>
    </button>
  );
}

function AuthoringSearchDialog({
  onClose,
  open,
}: {
  readonly onClose: () => void;
  readonly open: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      aria-label="Поиск по админке"
      className="authoring-search-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={() => {
        setText("");
        onClose();
      }}
      onKeyDown={(event) => {
        // Synthetic and assistive Escape presses do not always reach the native cancel.
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      ref={dialog}
    >
      {open ? (
        <SearchPanel onClose={onClose} onTextChange={setText} text={text} />
      ) : null}
    </dialog>
  );
}

function SearchPanel({
  onClose,
  onTextChange,
  text,
}: {
  readonly onClose: () => void;
  readonly onTextChange: (text: string) => void;
  readonly text: string;
}) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-results`;
  const debounced = useLiveSearchValue(text);
  const query = authoringSearchQuerySchema.safeParse(debounced);
  const search = useQuery({
    queryKey: authoringSearchQueryKey(query.success ? query.data : ""),
    queryFn: ({ signal }) =>
      requestAuthoringSearch(query.success ? query.data : "", signal),
    enabled: query.success,
    placeholderData: keepPreviousData,
  });
  // Results of the previous text stay visible while the new one is read, but they no longer
  // answer it: Enter and the arrows wait for the answer to the current text.
  const stale = search.isPlaceholderData || debounced !== text;
  const state: AuthoringSearchState | undefined = query.success
    ? search.data
    : undefined;
  const groups =
    state?.kind === "ready"
      ? state.groups.map((group) => ({
          group,
          entries: searchGroupEntries(group),
        }))
      : [];
  const entries = stale
    ? []
    : groups.flatMap(({ entries: groupEntries }) => groupEntries);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active =
    entries.find((entry) => entry.id === activeId) ?? entries[0] ?? null;

  function openEntry(entry: AuthoringSearchEntry) {
    onClose();
    router.push(entry.href);
  }

  function move(step: 1 | -1 | "first" | "last") {
    if (entries.length === 0) return;
    const index = active === null ? -1 : entries.indexOf(active);
    const next =
      step === "first"
        ? 0
        : step === "last"
          ? entries.length - 1
          : (index + step + entries.length) % entries.length;
    const entry = entries[next];
    if (entry === undefined) return;
    setActiveId(entry.id);
    document
      .getElementById(`${id}-${entry.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  const status = !query.success
    ? "Найдите человека, продукт или материал."
    : search.isPending || stale
      ? "Ищем…"
      : state === undefined
        ? "Поиск временно недоступен."
        : state.kind === "signed_out"
          ? "Сессия завершилась. Войдите снова, чтобы искать."
          : state.kind === "forbidden"
            ? "Поиск открыт аккаунту с правом управлять материалами или доступом."
            : state.kind === "unavailable"
              ? `Поиск временно недоступен. Код: ${state.reference}`
              : entries.length === 0 &&
                  groups.every(
                    ({ group }) =>
                      group.state === "ready" &&
                      searchGroupNote(group) === null,
                  )
                ? `По запросу «${query.data}» ничего не найдено.`
                : null;

  return (
    <div className="authoring-search-panel">
      <div className="authoring-search-field">
        <Search aria-hidden="true" className="authoring-search-field-icon" />
        <input
          aria-activedescendant={
            active === null ? undefined : `${id}-${active.id}`
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={entries.length > 0}
          aria-label="Что найти"
          autoComplete="off"
          maxLength={160}
          onChange={(event) => {
            onTextChange(event.currentTarget.value);
            setActiveId(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Home" && event.ctrlKey) {
              event.preventDefault();
              move("first");
            } else if (event.key === "End" && event.ctrlKey) {
              event.preventDefault();
              move("last");
            } else if (event.key === "Enter" && active !== null) {
              event.preventDefault();
              openEntry(active);
            }
          }}
          placeholder="Имя, email, продукт или материал"
          role="combobox"
          type="search"
          value={text}
        />
        <button
          aria-label="Закрыть поиск"
          className="authoring-search-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div
        aria-busy={search.isFetching || stale || undefined}
        className="authoring-search-results"
      >
        <p aria-live="polite" className="authoring-search-status">
          {status ?? `Найдено: ${String(entries.length)}`}
        </p>
        {state?.kind === "unavailable" ? (
          <button
            className="authoring-search-retry"
            onClick={() => {
              void search.refetch();
            }}
            type="button"
          >
            Повторить
          </button>
        ) : null}
        <div id={listId} role="listbox" aria-label="Результаты поиска">
          {groups.map(({ group, entries: groupEntries }) => {
            const heading = searchGroupPresentation[group.kind].heading;
            const headingId = `${id}-${group.kind}`;
            if (group.state === "unavailable")
              return (
                <p className="authoring-search-group-note" key={group.kind}>
                  {heading}: поиск временно недоступен.
                </p>
              );
            const note = searchGroupNote(group);
            if (groupEntries.length === 0)
              return note === null ? null : (
                <p className="authoring-search-group-note" key={group.kind}>
                  {heading}: {note}
                </p>
              );
            return (
              <Fragment key={group.kind}>
                {note === null ? null : (
                  <p className="authoring-search-group-note">
                    {heading}: {note}
                  </p>
                )}
                <div
                  aria-labelledby={headingId}
                  className="authoring-search-group"
                  role="group"
                >
                  <p className="authoring-search-group-heading" id={headingId}>
                    {heading}
                  </p>
                  {groupEntries.map((entry) => (
                    <div
                      aria-selected={entry.id === active?.id}
                      className="authoring-search-option"
                      id={`${id}-${entry.id}`}
                      key={entry.id}
                      onClick={() => {
                        openEntry(entry);
                      }}
                      onMouseMove={() => {
                        if (entry.id !== active?.id) setActiveId(entry.id);
                      }}
                      role="option"
                    >
                      <span className="authoring-search-option-title">
                        {entry.title}
                      </span>
                      {entry.caption === null || entry.caption === "" ? null : (
                        <span className="authoring-search-option-caption">
                          {entry.caption}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
      <p className="authoring-search-hint" aria-hidden="true">
        ↑↓ выбрать · Enter открыть · Esc закрыть
      </p>
    </div>
  );
}
