"use client";
import { billingActionClass } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

/**
 * Общий низ раздела billing: перечитать состояние и объяснить ожидаемую ошибку. Повтор здесь
 * безопасен, поэтому кнопка доступна и после неудачи.
 */
export function BillingSectionFooter({
  disabled,
  error,
  onRefresh,
}: {
  readonly disabled: boolean;
  readonly error: string | undefined;
  readonly onRefresh: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          className={billingActionClass}
          disabled={disabled}
          onClick={onRefresh}
          type="button"
          variant="outline"
        >
          Обновить данные
        </Button>
      </div>
      {error === undefined ? null : (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
          role="alert"
        >
          {error}
        </p>
      )}
    </>
  );
}
