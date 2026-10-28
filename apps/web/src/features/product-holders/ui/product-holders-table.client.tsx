"use client";

import { UserPlus } from "lucide-react";
import type { Route } from "next";
import { useId, type ReactNode } from "react";

import {
  formatMoscowDate,
  formatMoscowDateTime,
} from "@/shared/lib/moscow-format";
import { authoringPersonHref } from "@/shared/routing/authoring";
import {
  AdminCursorPagination,
  AdminEmptyState,
  AdminErrorState,
  AdminFilterBar,
  AdminNoResults,
  AdminTable,
  AdminTableSkeleton,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type {
  HolderAccess,
  HoldersAddress,
  ProductHolder,
  ProductHoldersState,
} from "../model/product-holders";
import {
  useHolderPersonCells,
  type HolderPersonCells,
} from "./holder-person.client";

/** Пока первое чтение идёт, у списка нет состояния: таблица показывает свой скелет. */
export type ProductHoldersViewState =
  ProductHoldersState | { readonly kind: "loading" };

export interface ProductHoldersTableProps {
  readonly state: ProductHoldersViewState;
  /** Страница и фильтр из адреса. */
  readonly address: HoldersAddress;
  /** Адрес страницы продукта с этой вкладкой, страницей и фильтром. */
  readonly hrefFor: (address: HoldersAddress) => Route;
  readonly onAddressChange: (address: HoldersAddress) => void;
  readonly onRetry: () => void;
  readonly onGrant: () => void;
  /** Повторное чтение: строки тускнеют, разметка стоит. */
  readonly refreshing?: boolean;
}

const accessOptions = [
  { value: "all", label: "Любой доступ" },
  { value: "active", label: "Доступ открыт" },
  { value: "revoked", label: "Доступ отозван" },
] as const;

const accessLabels: Record<HolderAccess, string> = {
  active: "Доступ открыт",
  revoked: "Доступ отозван",
};

/**
 * Вкладка «Ученики» без данных сервера: люди с доступом к продукту, их прогресс и последняя
 * активность. Отказ в праве показан отказом, а не пустым списком. На телефоне строки становятся
 * элементами списка.
 */
export function ProductHoldersTable({
  state,
  address,
  hrefFor,
  onAddressChange,
  onRetry,
  onGrant,
  refreshing = false,
}: ProductHoldersTableProps) {
  const headingId = useId();
  const refused = state.kind === "forbidden";
  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight" id={headingId}>
          Ученики
        </h2>
        {refused ? null : (
          <Button className="min-h-11 px-4" onClick={onGrant} type="button">
            <UserPlus aria-hidden="true" />
            Выдать продукт
          </Button>
        )}
      </div>
      {refused ? null : (
        <AdminFilterBar
          chips={
            address.access === undefined
              ? []
              : [
                  {
                    id: "access",
                    label: accessLabels[address.access],
                    onRemove: () => {
                      onAddressChange({});
                    },
                  },
                ]
          }
          filters={[
            {
              id: "access",
              label: "Доступ",
              value: address.access ?? "all",
              options: accessOptions,
              onChange: (value) => {
                onAddressChange(
                  value === "active" || value === "revoked"
                    ? { access: value }
                    : {},
                );
              },
            },
          ]}
          {...(address.access === undefined
            ? {}
            : {
                onReset: () => {
                  onAddressChange({});
                },
              })}
        />
      )}
      <HoldersBody
        address={address}
        hrefFor={hrefFor}
        onAddressChange={onAddressChange}
        onGrant={onGrant}
        onRetry={onRetry}
        refreshing={refreshing}
        state={state}
      />
    </section>
  );
}

function HoldersBody({
  state,
  address,
  hrefFor,
  onAddressChange,
  onRetry,
  onGrant,
  refreshing,
}: Required<ProductHoldersTableProps>) {
  switch (state.kind) {
    case "loading":
      return <AdminTableSkeleton columns={6} label="Загружаем учеников" />;
    case "forbidden":
      return (
        <AdminEmptyState
          description="Учеников продукта видит владелец с правом управлять продажами и доступом. Если оно нужно вам, попросите владельца его выдать."
          title="Нет права на просмотр учеников"
        />
      );
    case "signed_out":
      return (
        <AdminErrorState
          description="Войдите снова, чтобы увидеть учеников продукта."
          onRetry={onRetry}
          title="Сессия закончилась"
        />
      );
    case "not_found":
      return (
        <AdminErrorState
          description="Доступ к этому продукту не нашёл его в каталоге. Обновите страницу; если продукт удалён, вернитесь к списку продуктов."
          onRetry={onRetry}
          title="Продукт не найден"
        />
      );
    case "unavailable":
      return (
        <AdminErrorState
          description="Список учеников сейчас недоступен. Повторите через минуту; если не получится, сообщите код обращения."
          onRetry={onRetry}
          reference={state.reference}
          title="Не удалось загрузить учеников"
        />
      );
    case "invalid_request":
      return (
        <AdminNoResults
          description="Ссылка на эту страницу списка устарела. Откройте список с начала."
          onReset={() => {
            onAddressChange({});
          }}
          resetLabel="В начало списка"
          title="Страница списка устарела"
        />
      );
    case "ready":
      return (
        <HoldersList
          address={address}
          hrefFor={hrefFor}
          onAddressChange={onAddressChange}
          onGrant={onGrant}
          refreshing={refreshing}
          state={state}
        />
      );
  }
}

function HoldersList({
  state,
  address,
  hrefFor,
  onAddressChange,
  onGrant,
  refreshing,
}: {
  readonly state: Extract<ProductHoldersState, { readonly kind: "ready" }>;
  readonly address: HoldersAddress;
  readonly hrefFor: (address: HoldersAddress) => Route;
  readonly onAddressChange: (address: HoldersAddress) => void;
  readonly onGrant: () => void;
  readonly refreshing: boolean;
}) {
  const person = useHolderPersonCells(
    state.items.map((holder) => holder.accountId),
  );
  if (state.items.length === 0) {
    if (address.access !== undefined)
      return (
        <AdminNoResults
          description="Среди учеников нет никого с таким доступом. Сбросьте фильтр, чтобы увидеть всех."
          onReset={() => {
            onAddressChange({});
          }}
          title="Никого не найдено"
        />
      );
    if (address.cursor !== undefined)
      return (
        <AdminNoResults
          description="Дальше в списке никого нет."
          onReset={() => {
            onAddressChange({});
          }}
          resetLabel="В начало списка"
          title="Больше учеников нет"
        />
      );
    return (
      <AdminEmptyState
        action={
          <Button className="min-h-11 px-4" onClick={onGrant} type="button">
            Выдать продукт
          </Button>
        }
        description="Продукт появится у человека после покупки, активации курса через бота или выдачи вручную."
        title="Учеников пока нет"
      />
    );
  }
  const filter = address.access === undefined ? {} : { access: address.access };
  return (
    <>
      <AdminTable
        busy={refreshing}
        caption="Ученики продукта"
        columns={holderColumns(person)}
        mobileItem={(holder) => ({
          title: person.title(holder.accountId),
          caption: receivedText(holder),
          badge: <StateBadge state={`access.${holder.access}`} />,
          metric: progressText(holder),
        })}
        rowHref={(holder) => authoringPersonHref(holder.accountId)}
        rowKey={(holder) => holder.accountId}
        rowTitle={(holder) => person.title(holder.accountId)}
        rows={state.items}
      />
      <AdminCursorPagination
        label="Страницы учеников"
        newerHref={address.cursor === undefined ? null : hrefFor(filter)}
        newerLabel="В начало списка"
        olderHref={
          state.nextCursor === null
            ? null
            : hrefFor({ ...filter, cursor: state.nextCursor })
        }
        olderLabel="Дальше"
      />
    </>
  );
}

function holderColumns(
  person: HolderPersonCells,
): readonly AdminTableColumn<ProductHolder>[] {
  return [
    {
      id: "person",
      header: "Ученик",
      cell: (holder) => person.caption(holder.accountId),
    },
    {
      id: "access",
      header: "Доступ",
      width: "10rem",
      cell: (holder) => <StateBadge state={`access.${holder.access}`} />,
    },
    {
      id: "received",
      header: "Получен",
      width: "8.5rem",
      cell: (holder) => dateOrText(holder.firstIssuedAt, "Не указан"),
    },
    {
      id: "progress",
      header: "Прогресс",
      align: "end",
      width: "7.5rem",
      cell: progressText,
    },
    {
      id: "started",
      header: "Начал обучение",
      width: "9rem",
      cell: (holder) => dateOrText(holder.learning.startedAt, "Не начал"),
    },
    {
      id: "lastActivity",
      header: "Последняя активность",
      width: "11.5rem",
      cell: (holder) =>
        holder.learning.lastActivityAt === null ? (
          "Не было"
        ) : (
          <time dateTime={holder.learning.lastActivityAt}>
            {formatMoscowDateTime(holder.learning.lastActivityAt)}
          </time>
        ),
    },
  ];
}

function dateOrText(iso: string | null, absent: string): ReactNode {
  return iso === null ? (
    absent
  ) : (
    <time dateTime={iso}>{formatMoscowDate(iso)}</time>
  );
}

function receivedText(holder: ProductHolder): string {
  return holder.firstIssuedAt === null
    ? "Дата получения не указана"
    : `Получен ${formatMoscowDate(holder.firstIssuedAt)}`;
}

/** «12 из 40»: прочитано из опубликованной программы, по правилу прогресса продукта. */
function progressText(holder: ProductHolder): string {
  const { readCount, totalCount } = holder.learning;
  return totalCount === 0
    ? "Нет программы"
    : `${String(readCount)} из ${String(totalCount)}`;
}
