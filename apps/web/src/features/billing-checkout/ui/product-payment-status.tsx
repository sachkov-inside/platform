import Link from "next/link";
import type { Route } from "next";
import {
  attemptStateLabel,
  formatKopecks,
  type PurchaseStatus,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

export function ProductPaymentStatus({
  purchase,
  programmeHref,
  onRefresh,
  loading,
  onBuyAgain,
}: {
  readonly purchase: PurchaseStatus;
  readonly programmeHref: Route;
  readonly onRefresh: () => void;
  readonly loading: boolean;
  /** Новая покупка после попытки, которую сервер отменил без адреса формы (#1926). */
  readonly onBuyAgain: () => void;
}) {
  const cancelledWithoutForm =
    purchase.state === "failed" &&
    purchase.retirementReason === "form_address_lost";
  return (
    <section
      aria-label="Ваша покупка"
      className="rounded-2xl border border-border bg-card p-5 sm:p-7"
    >
      <p className="text-3xl font-bold tabular-nums">
        {formatKopecks(purchase.snapshot.firstPriceKopecks)}
      </p>
      <div className="mt-6 border-t border-border pt-6" aria-live="polite">
        <h2 className="text-xl font-semibold">
          {cancelledWithoutForm
            ? "Оплата отменена"
            : purchase.access === "ready"
              ? "Продукт открыт"
              : purchase.access === "unavailable"
                ? "Доступ завершён"
                : purchase.access === "preparing"
                  ? "Открываем доступ"
                  : attemptStateLabel(purchase.state)}
        </h2>
        {cancelledWithoutForm ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              Страница оплаты не открылась, поэтому мы отменили попытку в банке.
              Деньги не списаны.
            </p>
            <Button
              className="mt-5 min-h-12 w-full"
              type="button"
              onClick={onBuyAgain}
            >
              Купить снова
            </Button>
          </>
        ) : purchase.access === "ready" ? (
          <Button asChild className="mt-5 min-h-12 w-full">
            <Link href={programmeHref}>Открыть продукт</Link>
          </Button>
        ) : purchase.access === "unavailable" ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {(purchase.refundedKopecks ?? 0) > 0
                ? "Деньги возвращены. Доступ проверяем отдельно."
                : "Действующего доступа к продукту нет."}
            </p>
          </>
        ) : purchase.paymentUrl === null ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {purchase.access === "preparing"
                ? "Оплата подтверждена. Открываем доступ."
                : "Проверяем оплату."}
            </p>
            {purchase.access === "awaiting_payment" &&
            (purchase.state === "pending" || purchase.state === "unknown") ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Если страница оплаты не открылась, подождите 2 минуты. Мы
                отменим неоплаченную попытку в банке, и здесь появится кнопка
                «Купить снова».
              </p>
            ) : null}
          </>
        ) : (
          <Button asChild className="mt-5 min-h-12 w-full">
            <a href={purchase.paymentUrl}>Открыть страницу оплаты</a>
          </Button>
        )}
        <details className="mt-4 text-sm leading-6">
          <summary className="min-h-11 cursor-pointer">Оплата и чек</summary>
          <p>{attemptStateLabel(purchase.state)}</p>
          <p>
            Чек:{" "}
            {purchase.fiscalization === "confirmed"
              ? "отправлен"
              : purchase.fiscalization === "pending"
                ? "формируется"
                : purchase.fiscalization === "failed"
                  ? "ошибка формирования"
                  : "касса не подключена"}
            .
          </p>
          <Button
            onClick={onRefresh}
            disabled={loading}
            type="button"
            variant="outline"
            className="mt-3"
          >
            Проверить статус
          </Button>
        </details>
      </div>
    </section>
  );
}
