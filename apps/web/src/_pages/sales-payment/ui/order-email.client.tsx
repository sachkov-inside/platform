"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import type { OwnerReadState } from "@/features/owner-payments";
import { Button } from "@/shared/ui/button";

import { requestOrderEmail } from "../api/order-email.browser";
import { orderEmailQueryKey, type OrderEmail } from "../model/order-email";

/**
 * Email заказа на странице платежа. Он читается отдельным запросом только после «Показать email»,
 * не кешируется дольше показа и не попадает ни в список, ни в поиск.
 */
export function OrderEmailPanel({
  purchaseRef,
}: {
  readonly purchaseRef: string;
}) {
  const [shown, setShown] = useState(false);
  const queryClient = useQueryClient();
  const email = useQuery({
    enabled: shown,
    // Личный адрес не остаётся в памяти страницы после «Скрыть».
    gcTime: 0,
    queryFn: ({ signal }) => requestOrderEmail(purchaseRef, signal),
    queryKey: orderEmailQueryKey(purchaseRef),
    staleTime: 0,
  });
  return (
    <OrderEmailView
      onHide={() => {
        setShown(false);
        queryClient.removeQueries({
          queryKey: orderEmailQueryKey(purchaseRef),
        });
      }}
      onRetry={() => {
        void email.refetch();
      }}
      onShow={() => {
        setShown(true);
      }}
      state={
        !shown
          ? { kind: "hidden" }
          : email.isPending
            ? { kind: "loading" }
            : (email.data ?? { kind: "unavailable" })
      }
    />
  );
}

export type OrderEmailState =
  | OwnerReadState<OrderEmail>
  | { readonly kind: "hidden" }
  | { readonly kind: "loading" };

/** Вид блока по готовому состоянию: его показывают и страница, и Storybook. */
export function OrderEmailView({
  state,
  onShow,
  onHide,
  onRetry,
}: {
  readonly state: OrderEmailState;
  readonly onShow: () => void;
  readonly onHide: () => void;
  readonly onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="order-email-heading"
      className="grid gap-3 rounded-xl border border-border p-4"
    >
      <div className="grid gap-1">
        <h2 className="text-base font-semibold" id="order-email-heading">
          Email для чека
        </h2>
        <p className="text-sm text-muted-foreground">
          Адрес, который покупатель указал при оплате. Он виден только на этой
          странице.
        </p>
      </div>
      <div aria-live="polite" className="grid gap-3">
        <OrderEmailBody onRetry={onRetry} state={state} />
      </div>
      <div>
        {state.kind === "hidden" ? (
          <Button
            className="min-h-11 px-4"
            onClick={onShow}
            type="button"
            variant="outline"
          >
            <Eye aria-hidden="true" />
            Показать email
          </Button>
        ) : (
          <Button
            className="min-h-11 px-4"
            onClick={onHide}
            type="button"
            variant="ghost"
          >
            <EyeOff aria-hidden="true" />
            Скрыть email
          </Button>
        )}
      </div>
    </section>
  );
}

function OrderEmailBody({
  state,
  onRetry,
}: {
  readonly state: OrderEmailState;
  readonly onRetry: () => void;
}) {
  switch (state.kind) {
    case "hidden":
      return null;
    case "loading":
      return <p className="text-sm text-muted-foreground">Читаем email…</p>;
    case "ready":
      return state.value.email === null ? (
        <p className="text-sm">Покупатель не оставил email для этого заказа.</p>
      ) : (
        <p className="text-base font-medium [overflow-wrap:anywhere]">
          {state.value.email}
        </p>
      );
    case "not_found":
      return (
        <p className="text-sm">
          Для этого заказа email не сохранён или заказ не найден.
        </p>
      );
    case "forbidden":
      return (
        <p className="text-sm">
          У этого аккаунта нет права видеть email заказа.
        </p>
      );
    case "signed_out":
      return (
        <p className="text-sm">
          Сессия закончилась. Войдите снова, чтобы увидеть email.
        </p>
      );
    case "invalid_request":
    case "unavailable":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">Email сейчас не читается.</p>
          <Button
            className="min-h-11 px-4"
            onClick={onRetry}
            type="button"
            variant="outline"
          >
            Повторить
          </Button>
        </div>
      );
  }
}
