"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  attemptStateLabel,
  billingErrorMessage,
  formatBillingDate,
  formatKopecks,
  type AttemptState,
  type PurchaseStatus,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import { readBillingPurchaseStatus } from "../api/billing-checkout.browser";
import { recallPurchase } from "../model/checkout";

/** Банк ответил окончательно: дальше состояние меняет только сверка, а не опрос страницы. */
const settledStates: ReadonlySet<AttemptState> = new Set(["confirmed", "failed"]);

export interface PurchaseReturnViewProps {
  readonly purchase: PurchaseStatus | null;
  readonly loading?: boolean;
  readonly error?: string | undefined;
  readonly unknownReference?: boolean;
  readonly accountHref: string;
  readonly onRefresh: () => void;
}

/**
 * Возврат из банка сам по себе ничего не подтверждает: страница показывает состояние,
 * сохранённое сервером, и отделяет банковский исход от готовности доступа.
 */
export function PurchaseReturnView({
  purchase,
  loading = false,
  error,
  unknownReference = false,
  accountHref,
  onRefresh,
}: PurchaseReturnViewProps) {
  return (
    <section className="mx-auto grid max-w-2xl gap-5" aria-live="polite">
      <h1 className="text-balance text-4xl font-bold tracking-[-0.04em]">
        Возвращаемся из банка
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Переход обратно не подтверждает оплату. Ниже — состояние, которое
        сохранил наш сервер.
      </p>

      {unknownReference ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card">
          <p className="font-semibold">Не нашли начатую оплату в этом браузере.</p>
          <p className="mt-1 text-muted-foreground">
            Откройте платёжный кабинет: там видно действующую подписку и её
            оплаченный срок.
          </p>
          <Link
            className="mt-3 inline-flex h-auto min-h-11 max-w-full whitespace-normal items-center font-semibold text-action underline underline-offset-4"
            href={{ pathname: accountHref }}
          >
            Платёжный кабинет
          </Link>
        </div>
      ) : loading && purchase === null ? (
        <p role="status">Проверяем состояние оплаты…</p>
      ) : purchase === null ? null : (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <p className="text-lg font-semibold">
            {attemptStateLabel(purchase.state)}
          </p>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Тариф</dt>
              <dd className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                {purchase.snapshot.offer.name}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Сумма</dt>
              <dd className="font-mono tabular-nums">
                {formatKopecks(purchase.snapshot.firstPriceKopecks)}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Доступ</dt>
              <dd>
                {purchase.access === "ready"
                  ? "Открыт"
                  : purchase.access === "preparing"
                    ? "Открываем"
                    : "Ждёт подтверждения оплаты"}
              </dd>
            </div>
            {purchase.periodEndsAt === null ? null : (
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Оплачено до</dt>
                <dd className="font-mono tabular-nums">
                  {formatBillingDate(purchase.periodEndsAt)}
                </dd>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Чек</dt>
              <dd>
                {purchase.fiscalization === "confirmed"
                  ? "Отправлен"
                  : purchase.fiscalization === "failed"
                    ? "Не сформирован — разбираем"
                    : purchase.fiscalization === "pending"
                      ? "Формируется"
                      : "Касса не подключена"}
              </dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={loading}
              onClick={onRefresh}
              type="button"
              variant="outline"
            >
              Обновить состояние
            </Button>
            <Button asChild className="h-auto min-h-11 max-w-full whitespace-normal" variant="ghost">
              <Link href={{ pathname: accountHref }}>Платёжный кабинет</Link>
            </Button>
          </div>
        </div>
      )}

      {error === undefined ? null : (
        <p className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export interface PurchaseReturnPanelProps {
  readonly accountHref: string;
}

export function PurchaseReturnPanel({ accountHref }: PurchaseReturnPanelProps) {
  // sessionStorage существует только в браузере: снимок сервера пуст, поэтому гидратация
  // не расходится, а ссылка на покупку появляется сразу после неё.
  const hydrated = useSyncExternalStore(subscribeToNothing, always, never);
  const purchaseRef = useSyncExternalStore(
    subscribeToNothing,
    readRememberedPurchase,
    readNoPurchase,
  );
  const query = useQuery({
    queryKey: ["account", "billing-purchase", purchaseRef],
    queryFn: () => readBillingPurchaseStatus(purchaseRef ?? ""),
    enabled: purchaseRef !== null,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => {
      const result = query.state.data;
      return result?.ok === true && !settledStates.has(result.value.state)
        ? 3_000
        : false;
    },
  });
  const result = query.data;
  return (
    <PurchaseReturnView
      accountHref={accountHref}
      error={
        result?.ok === false ? billingErrorMessage(result.code) : undefined
      }
      loading={query.isFetching}
      onRefresh={() => {
        void query.refetch();
      }}
      purchase={result?.ok === true ? result.value : null}
      unknownReference={hydrated && purchaseRef === null}
    />
  );
}

function subscribeToNothing(): () => void {
  return () => undefined;
}
function always(): boolean {
  return true;
}
function never(): boolean {
  return false;
}
function readRememberedPurchase(): string | null {
  return recallPurchase() ?? null;
}
function readNoPurchase(): null {
  return null;
}
