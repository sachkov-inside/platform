"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  formatCountRu,
  formatMoscowDateTime,
  formatRubles,
} from "@/shared/lib/moscow-format";
import { cn } from "@/shared/lib/utils";
import {
  AdminEmptyState,
  AdminErrorState,
  AdminNoResults,
  AdminRowMenu,
  AdminTable,
  AdminTableSkeleton,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button, buttonVariants } from "@/shared/ui/button";

import type { OwnerReadState } from "../api/owner-payments.browser";
import type { PaymentView, PaymentsPage } from "../model/payment-contract";
import {
  emptyPaymentsQuery,
  hasPaymentsFilters,
  paymentsListRequest,
  withPaymentsCursor,
  type PaymentsQuery,
} from "../model/payment-filters";
import {
  paymentAccessBadge,
  paymentKindLabels,
  paymentLinksHref,
  paymentProductName,
  paymentStateBadge,
  salesPaymentHref,
} from "../model/payment-presentation";
import {
  ownerPaymentProductsQueryOptions,
  ownerPaymentsQueryOptions,
} from "../model/owner-payments-query";
import { PaymentBuyer } from "./payment-buyer";
import { PaymentFilters } from "./payment-filters.client";
import type { ProductChoices } from "./product-filter.client";

import "./owner-payments.css";

const paymentForms = ["платёж", "платежа", "платежей"] as const;

export interface PaymentsTableProps {
  /** Платежи одного человека: карточка человека (#1721) передаёт его аккаунт. */
  readonly accountId?: string;
  /**
   * Выбор, которым владеет страница, обычно её адрес. Без него таблица хранит выбор сама,
   * например внутри карточки человека.
   */
  readonly query?: PaymentsQuery;
  readonly onQueryChange?: (query: PaymentsQuery) => void;
}

/**
 * Список платежей владельца: фильтры, таблица (на телефоне список), продолжение и состояния.
 * Читает `payments.list` через BFF billing; email заказа сюда не попадает.
 */
export function PaymentsTable({
  accountId,
  query,
  onQueryChange,
}: PaymentsTableProps) {
  const [ownQuery, setOwnQuery] = useState<PaymentsQuery>(emptyPaymentsQuery);
  const current = query ?? ownQuery;
  const request = useMemo(
    () => paymentsListRequest(current, accountId),
    [current, accountId],
  );
  const list = useQuery({
    ...ownerPaymentsQueryOptions(request),
    placeholderData: keepPreviousData,
  });
  const products = useQuery(ownerPaymentProductsQueryOptions());
  const productChoices: ProductChoices =
    products.data?.kind === "ready"
      ? { kind: "ready", items: products.data.value }
      : products.isPending
        ? { kind: "pending" }
        : { kind: "unavailable" };

  return (
    <PaymentsTableView
      {...(accountId === undefined ? {} : { accountId })}
      isRefreshing={list.isFetching && !list.isPending}
      onQueryChange={onQueryChange ?? setOwnQuery}
      onRetry={() => {
        void list.refetch();
      }}
      products={productChoices}
      query={current}
      state={
        list.isPending
          ? { kind: "loading" }
          : (list.data ?? { kind: "unavailable" })
      }
    />
  );
}

export type PaymentsListState =
  OwnerReadState<PaymentsPage> | { readonly kind: "loading" };

/** Таблица платежей по готовому состоянию: её показывают и маршрут, и Storybook. */
export function PaymentsTableView({
  accountId,
  isRefreshing = false,
  onQueryChange,
  onRetry,
  products,
  query,
  state,
}: {
  readonly accountId?: string;
  readonly isRefreshing?: boolean;
  readonly onQueryChange: (query: PaymentsQuery) => void;
  readonly onRetry: () => void;
  readonly products: ProductChoices;
  readonly query: PaymentsQuery;
  readonly state: PaymentsListState;
}) {
  const [copied, setCopied] = useState("");
  const filtered = hasPaymentsFilters(query);
  const firstUse =
    state.kind === "ready" &&
    state.value.items.length === 0 &&
    state.value.nextCursor === null &&
    !filtered &&
    query.cursor === undefined;
  if (firstUse)
    return (
      <AdminEmptyState
        action={
          accountId === undefined ? (
            <Button asChild className="min-h-11 px-4" variant="outline">
              <Link href={paymentLinksHref}>Ссылки на оплату</Link>
            </Button>
          ) : undefined
        }
        description={
          accountId === undefined
            ? "Оплаты появятся здесь, как только покупатель оплатит продукт на сайте или по ссылке на оплату."
            : "Оплаты этого человека появятся здесь, как только он оплатит продукт."
        }
        title="Платежей пока нет"
      />
    );

  return (
    <div className="owner-payments" data-owner-payments="">
      <PaymentFilters
        onQueryChange={onQueryChange}
        products={products}
        query={query}
        resultLabel={
          filtered && state.kind === "ready"
            ? `Показано: ${formatCountRu(state.value.items.length, paymentForms)}`
            : undefined
        }
      />
      <PaymentsResults
        accountId={accountId}
        isRefreshing={isRefreshing}
        onCopied={setCopied}
        onQueryChange={onQueryChange}
        onRetry={onRetry}
        query={query}
        state={state}
      />
      <p aria-live="polite" className="sr-only" role="status">
        {copied}
      </p>
    </div>
  );
}

interface PaymentRow {
  readonly payment: PaymentView;
  readonly productName: string;
}

function PaymentsResults({
  accountId,
  isRefreshing,
  onCopied,
  onQueryChange,
  onRetry,
  query,
  state,
}: {
  readonly accountId: string | undefined;
  readonly isRefreshing: boolean;
  readonly onCopied: (message: string) => void;
  readonly onQueryChange: (query: PaymentsQuery) => void;
  readonly onRetry: () => void;
  readonly query: PaymentsQuery;
  readonly state: PaymentsListState;
}) {
  if (state.kind === "loading")
    return (
      <AdminTableSkeleton
        columns={columnsFor(accountId).length + 1}
        label="Загружаем платежи"
      />
    );
  if (state.kind !== "ready")
    return (
      <PaymentsFailure
        onReset={() => {
          onQueryChange(emptyPaymentsQuery);
        }}
        onRetry={onRetry}
        state={state}
      />
    );

  const { items, nextCursor } = state.value;
  const pagination = (
    <PaymentsPagination
      onFirst={
        query.cursor === undefined
          ? undefined
          : () => {
              onQueryChange(withPaymentsCursor(query, undefined));
            }
      }
      onOlder={
        nextCursor === null
          ? undefined
          : () => {
              onQueryChange(withPaymentsCursor(query, nextCursor));
            }
      }
    />
  );
  if (items.length === 0)
    return (
      <>
        {query.cursor !== undefined || nextCursor !== null ? (
          <AdminNoResults
            description="Платежи этой страницы больше не подходят под выбор. Продолжите список или вернитесь к его началу."
            title="На этой странице платежей нет"
          />
        ) : (
          <AdminNoResults
            description="Под выбранные состояние, продукт и период платежей нет. Сбросьте фильтры, чтобы увидеть все платежи."
            onReset={() => {
              onQueryChange(emptyPaymentsQuery);
            }}
            title="Платежи не найдены"
          />
        )}
        {pagination}
      </>
    );

  const rows: PaymentRow[] = items.map((payment) => ({
    payment,
    productName: paymentProductName(payment),
  }));
  return (
    <>
      <AdminTable
        busy={isRefreshing}
        caption="Платежи"
        columns={columnsFor(accountId)}
        mobileItem={(row) => ({
          badge: <StateBadge state={paymentStateBadge(row.payment.state)} />,
          caption: `${row.productName} · ${formatMoscowDateTime(row.payment.createdAt)}`,
          metric: formatRubles(row.payment.amountKopecks),
          title:
            accountId === undefined ? (
              <PaymentBuyer accountId={row.payment.accountId} />
            ) : (
              row.productName
            ),
        })}
        rowActions={(row) => (
          <AdminRowMenu
            items={[
              {
                href: salesPaymentHref(row.payment.purchaseRef),
                id: "open",
                label: "Открыть платёж",
              },
              {
                id: "copy",
                label: "Скопировать номер заказа",
                onSelect: () => {
                  void navigator.clipboard
                    .writeText(row.payment.purchaseRef)
                    .then(
                      () => {
                        onCopied("Номер заказа скопирован");
                      },
                      () => {
                        onCopied("Не удалось скопировать номер заказа");
                      },
                    );
                },
              },
            ]}
            label={`Действия с платежом от ${formatMoscowDateTime(row.payment.createdAt)}`}
          />
        )}
        rowHref={(row) => salesPaymentHref(row.payment.purchaseRef)}
        rowKey={(row) => row.payment.purchaseRef}
        rowTitle={(row) =>
          accountId === undefined ? (
            <PaymentBuyer accountId={row.payment.accountId} />
          ) : (
            row.productName
          )
        }
        rows={rows}
      />
      {pagination}
    </>
  );
}

const amountColumn: AdminTableColumn<PaymentRow> = {
  align: "end",
  cell: (row) => formatRubles(row.payment.amountKopecks),
  header: "Сумма",
  id: "amount",
  width: "8.5rem",
};
const stateColumn: AdminTableColumn<PaymentRow> = {
  cell: (row) => (
    <span className="owner-payments-state">
      <StateBadge state={paymentStateBadge(row.payment.state)} />
      {/* Готовность доступа значима только у оплаченного: до оплаты доступа нет по определению. */}
      {row.payment.state === "confirmed" ? (
        <StateBadge state={paymentAccessBadge(row.payment.access)} />
      ) : null}
    </span>
  ),
  header: "Состояние",
  id: "state",
  width: "13rem",
};
const timeColumn: AdminTableColumn<PaymentRow> = {
  cell: (row) => (
    <time dateTime={row.payment.createdAt}>
      {formatMoscowDateTime(row.payment.createdAt)}
    </time>
  ),
  header: "Время",
  id: "createdAt",
  width: "10.5rem",
};

/** Все платежи: человек, продукт, сумма, состояние, время. */
const ownerColumns: readonly AdminTableColumn<PaymentRow>[] = [
  {
    cell: (row) => paymentKindLabels[row.payment.kind],
    header: "Покупатель",
    id: "buyer",
  },
  {
    cell: (row) => row.productName,
    header: "Продукт",
    id: "product",
    width: "24%",
  },
  amountColumn,
  stateColumn,
  timeColumn,
];

/** Платежи одного человека: человек известен, первая колонка — продукт. */
const personColumns: readonly AdminTableColumn<PaymentRow>[] = [
  {
    cell: (row) => paymentKindLabels[row.payment.kind],
    header: "Продукт",
    id: "product",
  },
  amountColumn,
  stateColumn,
  timeColumn,
];

function columnsFor(
  accountId: string | undefined,
): readonly AdminTableColumn<PaymentRow>[] {
  return accountId === undefined ? ownerColumns : personColumns;
}

const stepClass = cn(
  buttonVariants({ variant: "outline" }),
  "min-h-11 min-w-11 gap-1.5 px-3",
);

/** Продолжение списка: к его началу и к более ранним платежам; номеров страниц у курсора нет. */
function PaymentsPagination({
  onFirst,
  onOlder,
}: {
  readonly onFirst: (() => void) | undefined;
  readonly onOlder: (() => void) | undefined;
}) {
  if (onFirst === undefined && onOlder === undefined) return null;
  return (
    <nav aria-label="Страницы платежей" className="admin-pagination">
      <div className="admin-pagination-controls">
        <button
          className={stepClass}
          disabled={onFirst === undefined}
          onClick={onFirst}
          type="button"
        >
          <ChevronLeft aria-hidden="true" />К началу списка
        </button>
        <button
          className={stepClass}
          disabled={onOlder === undefined}
          onClick={onOlder}
          type="button"
        >
          Более ранние
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

function PaymentsFailure({
  onReset,
  onRetry,
  state,
}: {
  readonly onReset: () => void;
  readonly onRetry: () => void;
  readonly state: Exclude<
    OwnerReadState<PaymentsPage>,
    { readonly kind: "ready" }
  >;
}) {
  switch (state.kind) {
    case "signed_out":
      return (
        <AdminErrorState
          description="Войдите под аккаунтом владельца, чтобы увидеть платежи."
          retry={
            <form action="/auth/sign-in" method="post">
              <Button className="min-h-11 px-4" type="submit">
                Войти через Telegram
              </Button>
            </form>
          }
          title="Нужен вход"
        />
      );
    case "forbidden":
      return (
        <AdminErrorState
          description="Платежи видит аккаунт с правом управлять оплатой. Войдите под ним и повторите."
          onRetry={onRetry}
          title="Нет доступа к платежам"
        />
      );
    case "invalid_request":
      return (
        <AdminErrorState
          description="Сервер не принял выбранные фильтры. Сбросьте их и откройте список заново."
          retry={
            <Button
              className="min-h-11 px-4"
              onClick={onReset}
              type="button"
              variant="outline"
            >
              Сбросить фильтры
            </Button>
          }
          title="Фильтры не подошли"
        />
      );
    case "not_found":
    case "unavailable":
      return (
        <AdminErrorState
          description="Платежи сейчас не читаются. Сами оплаты не изменились, повторите чтение."
          onRetry={onRetry}
          {...(state.kind === "unavailable" && state.reference !== undefined
            ? { reference: state.reference }
            : {})}
          title="Платежи временно недоступны"
        />
      );
  }
}
