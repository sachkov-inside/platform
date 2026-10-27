import type { OwnerReadState, PaymentPage } from "@/features/owner-payments";
import {
  AdminErrorState,
  AdminNotFound,
  AdminTableSkeleton,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { SalesPaymentFrame } from "./sales-payment-view.client";

/** Платёж, пока он читается: тот же каркас и возврат к списку. */
export function SalesPaymentLoading() {
  return (
    <SalesPaymentFrame busy label="Загрузка платежа">
      <div aria-hidden="true" className="grid gap-3">
        <span className="admin-skeleton-bar block h-8 w-3/5" />
        <span className="admin-skeleton-bar block h-4 w-2/5" />
        <span className="admin-skeleton-bar block h-8 w-1/4" />
      </div>
      <AdminTableSkeleton columns={2} label="Загружаем платёж" rows={9} />
    </SalesPaymentFrame>
  );
}

/** Платёж не прочитан: причина и следующий шаг. */
export function SalesPaymentFailure({
  state,
  onRetry,
}: {
  readonly state: Exclude<
    OwnerReadState<PaymentPage>,
    { readonly kind: "ready" }
  >;
  readonly onRetry: () => void;
}) {
  return (
    <SalesPaymentFrame label="Платёж">
      <FailureBody onRetry={onRetry} state={state} />
    </SalesPaymentFrame>
  );
}

function FailureBody({
  state,
  onRetry,
}: {
  readonly state: Exclude<
    OwnerReadState<PaymentPage>,
    { readonly kind: "ready" }
  >;
  readonly onRetry: () => void;
}) {
  switch (state.kind) {
    case "not_found":
    case "invalid_request":
      return (
        <AdminNotFound
          backHref="/authoring/sales/payments"
          backLabel="Все платежи"
          description="По этому адресу платежа нет. Откройте его из списка платежей."
          title="Платёж не найден"
        />
      );
    case "signed_out":
      return (
        <AdminErrorState
          description="Войдите под аккаунтом владельца, чтобы открыть платёж."
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
          title="Нет доступа к платежу"
        />
      );
    case "unavailable":
      return (
        <AdminErrorState
          description="Платёж сейчас не читается. Сама оплата не изменилась, повторите чтение."
          onRetry={onRetry}
          {...(state.reference === undefined
            ? {}
            : { reference: state.reference })}
          title="Платёж временно недоступен"
        />
      );
  }
}
