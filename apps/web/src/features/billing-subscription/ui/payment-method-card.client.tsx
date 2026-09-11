"use client";
import { billingActionClass, type SubscriptionView } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

export interface PaymentMethodCardProps {
  readonly subscription: SubscriptionView | null;
  readonly pending: boolean;
  readonly onChangeMethod: () => void;
  readonly onRevokeMethod: () => void;
}

/**
 * Способ оплаты живёт рядом со списаниями: запрет останавливает будущие списания, но карту
 * в банке не удаляет, а начатая привязка остаётся видимой отдельным фактом.
 */
export function PaymentMethodCard({
  subscription,
  pending,
  onChangeMethod,
  onRevokeMethod,
}: PaymentMethodCardProps) {
  const method = subscription?.paymentMethod ?? null;
  return (
    <section
      aria-labelledby="billing-payment-method"
      className="rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <h2 className="text-xl font-semibold" id="billing-payment-method">
        Способ оплаты
      </h2>
      <p className="mt-3 text-sm leading-6">
        {subscription === null
          ? "Карта сохраняется при оформлении подписки."
          : method === null
            ? "Карта не сохранена."
            : method.revoked
              ? "Использование карты запрещено."
              : "Карта сохранена."}
      </p>

      {subscription?.pendingMethodChange == null ? null : (
        <p className="mt-4 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6">
          Начата привязка нового способа оплаты.{" "}
          {subscription.pendingMethodChange.formUrl === null ? (
            "Ждём результат банка."
          ) : (
            <a
              className="text-action underline underline-offset-4"
              href={subscription.pendingMethodChange.formUrl}
              rel="noreferrer"
            >
              Продолжить в банке
            </a>
          )}
        </p>
      )}

      {subscription === null ? null : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              className={billingActionClass}
              disabled={pending}
              onClick={onChangeMethod}
              type="button"
              variant="outline"
            >
              Привязать другую карту
            </Button>
            {method === null || method.revoked ? null : (
              <Button
                className={billingActionClass}
                disabled={pending}
                onClick={onRevokeMethod}
                type="button"
                variant="ghost"
              >
                Запретить использование
              </Button>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Запрет останавливает будущие списания. Карту в банке мы не удаляем.
          </p>
        </>
      )}
    </section>
  );
}
