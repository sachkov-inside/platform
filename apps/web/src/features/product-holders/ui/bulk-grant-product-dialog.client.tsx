"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent,
} from "react";

import type { NameSearchState } from "@/entities/authoring-person";
import { formatCountRu, pluralRu } from "@/shared/lib/moscow-format";
import { hasText, presentText } from "@/shared/lib/text";
import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";
import { StateBadge, type ReasonOption } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  BULK_GRANT_LIMIT,
  bulkGrantErrorText,
  bulkGrantOutcomeLabels,
  createBulkGrantBatch,
  failedAccountIds,
  precheckOutcome,
  runBulkGrant,
  type BulkGrantBatch,
  type BulkGrantRowResult,
  type BulkGrantSend,
} from "../model/bulk-grant";
import type { HolderAccess } from "../model/product-holders";
import { productHoldersQueryOptions } from "../model/product-holders-query-options";

/**
 * Человек из поиска в форме `PersonIdentity` (#1721, `@/entities/authoring-person`): имя Telegram,
 * @username и email приходят, только если у читающего есть право; любое из них может отсутствовать.
 */
export interface GrantPerson {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly username: string | null;
  readonly email: string | null;
}

/**
 * Состояние поиска людей для выбора; поиск принадлежит #1721, диалог его только показывает.
 * `nameSearch: "unavailable"`: по имени сейчас искать нельзя, по email и ID можно; `truncated`:
 * совпало больше людей, чем показано.
 */
export type GrantPeopleSearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly items: readonly GrantPerson[];
      readonly nameSearch: NameSearchState;
    }
  | { readonly kind: "unavailable" };

/** Хук поиска людей. Получает уже устоявшийся запрос (после паузы ввода), пустой до ввода. */
export type UseGrantPeopleSearch = (query: string) => GrantPeopleSearchState;

export interface GrantProductDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly productId: string;
  readonly productName: string;
  readonly usePeopleSearch: UseGrantPeopleSearch;
  /** Одна ручная выдача Product Access на человека. */
  readonly send: BulkGrantSend;
  /** Хотя бы одному человеку продукт выдан: страница перечитывает учеников. */
  readonly onGranted: () => void;
}

const otherReason = "other";
export const grantReasons: readonly ReasonOption[] = [
  { value: "gift", label: "Подарок" },
  { value: "support", label: "Компенсация или решение поддержки" },
  { value: "offline-payment", label: "Оплата вне сайта" },
  { value: "team", label: "Команда и партнёры" },
  { value: otherReason, label: "Другое" },
];

const peopleForms = ["человеку", "людям", "людям"] as const;

/**
 * «Выдать продукт» нескольким людям: выбор поиском (до 50), одна причина, проверка доступа
 * заранее и итог по каждому человеку. Выполняет `runBulkGrant`; повтор отправляет только строки
 * с ошибкой с теми же ссылками. Пока выдача идёт, диалог не закрывается.
 */
export function GrantProductDialog(props: GrantProductDialogProps) {
  const { open, onOpenChange } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);

  // Синхронизация с модальным слоем браузера, как у `ReasonDialog`.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={`${id}-description`}
      aria-labelledby={`${id}-heading`}
      className="admin-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onOpenChange(false);
      }}
      onClose={(event) => {
        if (open && !event.currentTarget.open) onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (!busy) onOpenChange(false);
      }}
      ref={dialog}
    >
      {open ? <GrantForm {...props} dialogId={id} onBusy={setBusy} /> : null}
    </dialog>
  );
}

interface GrantRun {
  readonly batch: BulkGrantBatch;
  readonly names: ReadonlyMap<string, string>;
  /** Уже известный итог по проверке заранее: таких людей не отправляли. */
  readonly known: readonly {
    readonly accountId: string;
    readonly outcome: "already_active" | "revoked";
  }[];
  readonly results: ReadonlyMap<string, BulkGrantRowResult>;
  readonly running: boolean;
}

function GrantForm({
  dialogId,
  onBusy,
  onOpenChange,
  productId,
  productName,
  usePeopleSearch,
  send,
  onGranted,
}: GrantProductDialogProps & {
  readonly dialogId: string;
  readonly onBusy: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<readonly GrantPerson[]>([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [run, setRun] = useState<GrantRun | null>(null);
  const firstReason = useRef<HTMLInputElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);

  const search = usePeopleSearch(useLiveSearchValue(query.trim()));
  const selectedIds = selected.map((person) => person.accountId);
  const precheck = useQuery({
    ...productHoldersQueryOptions({ productId, accountIds: selectedIds }),
    enabled: selectedIds.length > 0 && run === null,
    placeholderData: keepPreviousData,
  });
  const precheckSettled =
    selectedIds.length === 0 ||
    (precheck.data !== undefined && !precheck.isPlaceholderData);
  const flags = new Map<string, HolderAccess>(
    precheckSettled && precheck.data?.kind === "ready"
      ? precheck.data.items.map((holder) => [holder.accountId, holder.access])
      : [],
  );
  const refused = precheckSettled && precheck.data?.kind === "forbidden";
  const unchecked =
    precheckSettled &&
    precheck.data !== undefined &&
    precheck.data.kind !== "ready" &&
    !refused;
  const toSend = selected.filter((person) => !flags.has(person.accountId));
  const full = selected.length >= BULK_GRANT_LIMIT;

  const noteRequired = reason === otherReason;
  const reasonError = reason === "" ? "Выберите причину" : null;
  const noteError =
    noteRequired && note.trim() === "" ? "Опишите причину" : null;

  const headingId = `${dialogId}-heading`;
  const descriptionId = `${dialogId}-description`;
  const title = `Выдать «${productName}»`;

  const execute = async (
    batch: BulkGrantBatch,
    accountIds: readonly string[],
  ) => {
    onBusy(true);
    const results = await runBulkGrant(batch, accountIds, send, (result) => {
      setRun((current) =>
        current === null
          ? current
          : {
              ...current,
              results: new Map(current.results).set(result.accountId, result),
            },
      );
    });
    setRun((current) =>
      current === null ? current : { ...current, running: false },
    );
    onBusy(false);
    if (results.some((result) => result.outcome === "issued")) onGranted();
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (run !== null || !precheckSettled || refused || toSend.length === 0)
      return;
    setSubmitted(true);
    if (reasonError !== null) {
      firstReason.current?.focus();
      return;
    }
    if (noteError !== null) {
      noteField.current?.focus();
      return;
    }
    const label =
      grantReasons.find((option) => option.value === reason)?.label ?? reason;
    const batch = createBulkGrantBatch({
      batchId: crypto.randomUUID(),
      productId,
      reason: hasText(note.trim()) ? `${label}: ${note.trim()}` : label,
      accountIds: toSend.map((person) => person.accountId),
    });
    setRun({
      batch,
      names: new Map(
        selected.map((person) => [person.accountId, personName(person)]),
      ),
      known: selected.flatMap((person) => {
        const access = flags.get(person.accountId);
        return access === undefined
          ? []
          : [{ accountId: person.accountId, outcome: precheckOutcome(access) }];
      }),
      results: new Map(),
      running: true,
    });
    void execute(batch, batch.accountIds);
  };

  if (run !== null)
    return (
      <GrantResults
        descriptionId={descriptionId}
        headingId={headingId}
        onClose={() => {
          onOpenChange(false);
        }}
        onRetry={() => {
          const failed = failedAccountIds(run.results);
          const remaining = new Map(run.results);
          for (const accountId of failed) remaining.delete(accountId);
          setRun({ ...run, results: remaining, running: true });
          void execute(run.batch, failed);
        }}
        run={run}
        title={title}
      />
    );

  return (
    <form className="admin-dialog-body" noValidate onSubmit={submit}>
      <div>
        <h2 id={headingId}>{title}</h2>
        <p className="admin-dialog-consequence" id={descriptionId}>
          Выберите до {BULK_GRANT_LIMIT} человек и одну причину. Каждый получит
          бессрочный доступ к продукту. У кого доступ уже есть, ничего не
          изменится.
        </p>
      </div>
      <PeopleSearch
        disabled={full}
        onAdd={(person) => {
          setSelected((current) =>
            current.length >= BULK_GRANT_LIMIT ||
            current.some((item) => item.accountId === person.accountId)
              ? current
              : [...current, person],
          );
        }}
        query={query}
        search={search}
        selectedIds={selectedIds}
        setQuery={setQuery}
      />
      <SelectedPeople
        flags={flags}
        full={full}
        onRemove={(accountId) => {
          setSelected((current) =>
            current.filter((person) => person.accountId !== accountId),
          );
        }}
        selected={selected}
      />
      {refused ? (
        <Banner tone="critical">
          Нет права выдавать продукты: выдачу и учеников видит владелец с правом
          управлять продажами и доступом.
        </Banner>
      ) : unchecked ? (
        <Banner tone="neutral">
          Не удалось заранее проверить, у кого доступ уже есть. Итог покажет
          каждая строка после выдачи.
        </Banner>
      ) : null}
      <fieldset
        aria-describedby={
          submitted && reasonError !== null
            ? `${dialogId}-reason-error`
            : undefined
        }
        aria-invalid={submitted && reasonError !== null}
        aria-labelledby={`${dialogId}-reason-legend`}
        aria-required="true"
        className="admin-reasons"
        role="radiogroup"
      >
        <legend id={`${dialogId}-reason-legend`}>Причина</legend>
        {grantReasons.map((option, index) => (
          <label className="admin-reason" key={option.value}>
            <input
              checked={reason === option.value}
              name={`${dialogId}-reason`}
              onChange={() => {
                setReason(option.value);
              }}
              ref={index === 0 ? firstReason : undefined}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
        {submitted && reasonError !== null ? (
          <FieldError id={`${dialogId}-reason-error`}>{reasonError}</FieldError>
        ) : null}
      </fieldset>
      <div className="admin-field">
        <label className="admin-field-label" htmlFor={`${dialogId}-note`}>
          Комментарий
          {noteRequired ? null : (
            <span className="font-normal text-muted-foreground">
              {" "}
              (необязательно)
            </span>
          )}
        </label>
        <textarea
          aria-describedby={
            submitted && noteError !== null
              ? `${dialogId}-note-error`
              : undefined
          }
          aria-invalid={submitted && noteError !== null}
          className="admin-field-textarea"
          id={`${dialogId}-note`}
          maxLength={500}
          onChange={(event) => {
            setNote(event.currentTarget.value);
          }}
          ref={noteField}
          required={noteRequired}
          value={note}
        />
        {submitted && noteError !== null ? (
          <FieldError id={`${dialogId}-note-error`}>{noteError}</FieldError>
        ) : null}
      </div>
      <div className="admin-dialog-footer">
        <Button
          className="min-h-11 px-4"
          onClick={() => {
            onOpenChange(false);
          }}
          type="button"
          variant="outline"
        >
          Отмена
        </Button>
        <Button
          aria-busy={!precheckSettled}
          className="min-h-11 px-4"
          disabled={!precheckSettled || refused || toSend.length === 0}
          type="submit"
        >
          {precheckSettled ? null : (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          )}
          {submitLabel(selected.length, toSend.length, precheckSettled)}
        </Button>
      </div>
    </form>
  );
}

/** Чем назвать человека: имя, затем @username, email и в конце короткий ID аккаунта. */
function personName(person: GrantPerson): string {
  return (
    presentText(person.displayName) ??
    (hasText(person.username) ? `@${person.username}` : undefined) ??
    presentText(person.email) ??
    `Аккаунт ${person.accountId.slice(0, 8)}`
  );
}

/** Подстрока, по которой человека узнают: то, что не стало его именем. */
function personDetail(person: GrantPerson): string {
  const name = personName(person);
  return [hasText(person.username) ? `@${person.username}` : null, person.email]
    .filter((part): part is string => hasText(part) && part !== name)
    .join(" · ");
}

function submitLabel(
  selected: number,
  toSend: number,
  settled: boolean,
): string {
  if (!settled) return "Проверяем доступ";
  if (selected > 0 && toSend === 0) return "Всем уже выдан";
  if (toSend === 0) return "Выдать продукт";
  return `Выдать ${String(toSend)} ${pluralRu(toSend, peopleForms)}`;
}

function PeopleSearch({
  query,
  setQuery,
  search,
  selectedIds,
  disabled,
  onAdd,
}: {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly search: GrantPeopleSearchState;
  readonly selectedIds: readonly string[];
  readonly disabled: boolean;
  readonly onAdd: (person: GrantPerson) => void;
}) {
  const id = useId();
  const chosen = new Set(selectedIds);
  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        Найти человека
      </label>
      <input
        autoComplete="off"
        className="admin-field-input admin-field-input-wide"
        enterKeyHint="search"
        id={id}
        maxLength={200}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          // Enter в поиске не отправляет форму выдачи.
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Имя, @username, email или ID"
        type="search"
        value={query}
      />
      <div aria-live="polite" className="grid gap-2" role="status">
        <SearchOutcome search={search} />
      </div>
      {search.kind === "ready" && search.items.length > 0 ? (
        <ul aria-label="Найденные люди" className="grid gap-1">
          {search.items.map((person) => {
            const isChosen = chosen.has(person.accountId);
            return (
              <li key={person.accountId}>
                <button
                  aria-label={
                    isChosen
                      ? `${personName(person)}: уже выбран`
                      : `Добавить ${personName(person)}`
                  }
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                  disabled={isChosen || disabled}
                  onClick={() => {
                    onAdd(person);
                  }}
                  type="button"
                >
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">
                      {personName(person)}
                    </span>
                    {hasText(personDetail(person)) ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {personDetail(person)}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {isChosen ? "Выбран" : "Добавить"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function SearchOutcome({
  search,
}: {
  readonly search: GrantPeopleSearchState;
}) {
  const hint = "text-sm text-muted-foreground";
  switch (search.kind) {
    case "idle":
      return null;
    case "loading":
      return <p className={hint}>Ищем людей</p>;
    case "unavailable":
      return (
        <p className={hint}>
          Поиск людей сейчас недоступен. Повторите через минуту.
        </p>
      );
    case "ready":
      return (
        <>
          {search.nameSearch === "unavailable" ? (
            <p className={hint}>
              Поиск по имени временно недоступен. Найдите человека по email или
              ID.
            </p>
          ) : null}
          {search.nameSearch === "truncated" ? (
            <p className={hint}>Показаны не все совпадения. Уточните запрос.</p>
          ) : null}
          {search.items.length === 0 ? (
            <p className={hint}>
              Никого не нашли. Проверьте написание или найдите человека по email
              или ID.
            </p>
          ) : null}
        </>
      );
  }
}

function SelectedPeople({
  selected,
  flags,
  full,
  onRemove,
}: {
  readonly selected: readonly GrantPerson[];
  readonly flags: ReadonlyMap<string, HolderAccess>;
  readonly full: boolean;
  readonly onRemove: (accountId: string) => void;
}) {
  if (selected.length === 0)
    return (
      <p className="text-sm text-muted-foreground">Пока никто не выбран.</p>
    );
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">
        Выбрано {selected.length} из {BULK_GRANT_LIMIT}
      </p>
      <ul aria-label="Выбранные люди" className="admin-filter-chips">
        {selected.map((person) => {
          const access = flags.get(person.accountId);
          return (
            <li
              className="admin-filter-chip h-auto py-1"
              data-removable=""
              key={person.accountId}
            >
              <span className="grid min-w-0 gap-1">
                <span className="truncate">{personName(person)}</span>
                {access === undefined ? null : (
                  <span className="text-xs font-normal text-muted-foreground">
                    {access === "active"
                      ? "Уже есть доступ"
                      : "Доступ отозван, восстановите в карточке человека"}
                  </span>
                )}
              </span>
              <button
                aria-label={`Убрать ${personName(person)}`}
                onClick={() => {
                  onRemove(person.accountId);
                }}
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
      {full ? (
        <p className="text-sm text-muted-foreground">
          За раз можно выдать не больше {BULK_GRANT_LIMIT} людям. Остальным
          выдайте следующим разом.
        </p>
      ) : null}
    </div>
  );
}

function GrantResults({
  run,
  title,
  headingId,
  descriptionId,
  onRetry,
  onClose,
}: {
  readonly run: GrantRun;
  readonly title: string;
  readonly headingId: string;
  readonly descriptionId: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Форма выдачи ушла вместе с фокусом: он переходит на заголовок итога внутри диалога.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const failed = failedAccountIds(run.results);
  const counts = { issued: 0, already_active: 0, revoked: 0, error: 0 };
  for (const result of run.results.values()) counts[result.outcome] += 1;
  for (const known of run.known) counts[known.outcome] += 1;
  const done = run.results.size;
  const total = run.batch.accountIds.length;
  const rows: readonly {
    readonly accountId: string;
    readonly outcome: BulkGrantRowResult["outcome"] | "pending";
    readonly code?: string;
  }[] = [
    ...run.batch.accountIds.map(
      (accountId) =>
        run.results.get(accountId) ?? {
          accountId,
          outcome: "pending" as const,
        },
    ),
    ...run.known,
  ];
  return (
    <div className="admin-dialog-body">
      <div>
        <h2 className="outline-none" id={headingId} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <p
          aria-live="polite"
          className="admin-dialog-consequence"
          id={descriptionId}
          role="status"
        >
          {run.running
            ? `Выдаём продукт: готово ${String(done)} из ${String(total)}.`
            : summaryText(counts)}
        </p>
      </div>
      <ul aria-label="Итог выдачи" className="grid gap-1">
        {rows.map((row) => (
          <li
            className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-2 text-sm last:border-b-0"
            key={row.accountId}
          >
            <span className="min-w-0 font-medium break-words">
              {run.names.get(row.accountId) ?? row.accountId.slice(0, 8)}
            </span>
            <RowOutcome code={row.code} outcome={row.outcome} />
          </li>
        ))}
      </ul>
      <div className="admin-dialog-footer">
        {!run.running && failed.length > 0 ? (
          <Button
            className="min-h-11 px-4"
            onClick={onRetry}
            type="button"
            variant="outline"
          >
            Повторить для{" "}
            {formatCountRu(failed.length, ["человека", "человек", "человек"])}
          </Button>
        ) : null}
        <Button
          className="min-h-11 px-4"
          disabled={run.running}
          onClick={onClose}
          type="button"
        >
          {run.running ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          Готово
        </Button>
      </div>
    </div>
  );
}

function RowOutcome({
  outcome,
  code,
}: {
  readonly outcome: BulkGrantRowResult["outcome"] | "pending";
  readonly code: string | undefined;
}) {
  switch (outcome) {
    case "pending":
      return <span className="text-muted-foreground">Выдаём</span>;
    case "issued":
      return (
        <span className="inline-flex items-center gap-1.5">
          <Check aria-hidden="true" className="size-4" />
          {bulkGrantOutcomeLabels.issued}
        </span>
      );
    case "already_active":
      return <StateBadge state="access.active" />;
    case "revoked":
      return (
        <span className="text-muted-foreground">
          {bulkGrantOutcomeLabels.revoked}
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1.5 text-destructive">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          {bulkGrantErrorText(code)}
        </span>
      );
  }
}

function summaryText(counts: Record<BulkGrantRowResult["outcome"], number>) {
  const parts = [
    counts.issued > 0 ? `выдано ${String(counts.issued)}` : null,
    counts.already_active > 0
      ? `уже был доступ у ${String(counts.already_active)}`
      : null,
    counts.revoked > 0 ? `доступ отозван у ${String(counts.revoked)}` : null,
    counts.error > 0 ? `не удалось ${String(counts.error)}` : null,
  ].filter((part) => part !== null);
  return `Готово: ${parts.join(", ")}.`;
}

function Banner({
  tone,
  children,
}: {
  readonly tone: "critical" | "neutral";
  readonly children: ReactNode;
}) {
  return tone === "critical" ? (
    <div className="admin-dialog-banner" role="alert">
      <CircleAlert aria-hidden="true" />
      <span>{children}</span>
    </div>
  ) : (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm">{children}</p>
  );
}

function FieldError({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}) {
  return (
    <p className="admin-field-error" id={id}>
      <CircleAlert aria-hidden="true" />
      {children}
    </p>
  );
}
