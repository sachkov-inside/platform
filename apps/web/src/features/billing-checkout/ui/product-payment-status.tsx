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
  readonly onBuyAgain: () => void;
}) {
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
          {purchase.access === "ready"
            ? "Продукт открыт"
            : purchase.access === "unavailable"
              ? "Доступ завершён"
              : purchase.access === "preparing"
                ? "Открываем доступ"
                : attemptStateLabel(purchase.state)}
        </h2>
        {purchase.access === "ready" ? (
          <Button asChild className="mt-5 min-h-12 w-full">
            <Link href={programmeHref}>Открыть продукт</Link>
          </Button>
        ) : purchase.access === "unavailable" ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {(purchase.refundedKopecks ?? 0) > 0
                ? "Деньги возвращены. Права этой покупки отозваны."
                : "Действующего доступа к продукту нет."}
            </p>
            <Button
              className="mt-5 min-h-12 w-full"
              type="button"
              onClick={onBuyAgain}
            >
              Купить снова
            </Button>
          </>
        ) : purchase.paymentUrl === null ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {purchase.access === "preparing"
              ? "Оплата подтверждена. Подготавливаем продукт."
              : "Проверяем сохранённую оплату."}
          </p>
        ) : (
          <Button asChild className="mt-5 min-h-12 w-full">
            <a href={purchase.paymentUrl}>Открыть страницу оплаты</a>
          </Button>
        )}
        <details className="mt-4 text-sm leading-6">
          <summary className="min-h-11 cursor-pointer">
            Состояние оплаты и чека
          </summary>
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
            Обновить состояние
          </Button>
        </details>
      </div>
    </section>
  );
}
