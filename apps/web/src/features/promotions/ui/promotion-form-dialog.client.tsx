"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import type { ProductPriceChoice } from "@/entities/subscription";
import { formatRubles } from "@/shared/lib/moscow-format";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import {
  AdminDialog,
  AdminDialogError,
  AdminSearchChecklist,
  DateField,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { savePromotion } from "../api/promotions.browser";
import {
  promotionCommand,
  type PromotionFormErrors,
  type PromotionFormValues,
  type PromotionOrigin,
} from "../model/promotion-form";
import { saveFailureMessage } from "../model/promotions-presentation";

/** Что открыто в форме: новая скидка с заранее выданным ключом или изменение строки списка. */
export interface PromotionDraft {
  readonly id: string;
  readonly initial: PromotionFormValues;
  /** Есть у изменения: редакция и сохранённые моменты периода из списка. */
  readonly origin?: PromotionOrigin;
}

/**
 * Создание и изменение скидки. Продукты выбираются из каталога цен поиском (пустой выбор значит
 * «все продукты»), период задаётся днями по Москве. Изменение отправляет редакцию из списка;
 * если скидку уже изменили, форма предлагает обновить данные.
 */
export function PromotionFormDialog({
  draft,
  products,
  onClose,
  onSaved,
  onRefresh,
}: {
  readonly draft: PromotionDraft | null;
  readonly products: readonly ProductPriceChoice[];
  readonly onClose: () => void;
  readonly onSaved: (name: string, created: boolean) => void;
  /** Перечитать список после конфликта редакции. */
  readonly onRefresh: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <AdminDialog
      description={
        draft?.origin === undefined
          ? "Покупатель получает одну лучшую скидку: проценты разных скидок не складываются."
          : "Новые расчёты пойдут по изменённой скидке. Уже сохранённые расчёты и оплаты не меняются."
      }
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={draft !== null}
      pending={pending}
      title={draft?.origin === undefined ? "Новая скидка" : "Изменить скидку"}
    >
      {draft === null ? null : (
        <PromotionForm
          draft={draft}
          onCancel={onClose}
          onPendingChange={setPending}
          onRefresh={onRefresh}
          onSaved={onSaved}
          products={products}
        />
      )}
    </AdminDialog>
  );
}

function PromotionForm({
  draft,
  products,
  onCancel,
  onSaved,
  onRefresh,
  onPendingChange,
}: {
  readonly draft: PromotionDraft;
  readonly products: readonly ProductPriceChoice[];
  readonly onCancel: () => void;
  readonly onSaved: (name: string, created: boolean) => void;
  readonly onRefresh: () => void;
  readonly onPendingChange: (pending: boolean) => void;
}) {
  const id = useId();
  const repeat = useRepeatableOperations();
  const [values, setValues] = useState(draft.initial);
  const [errors, setErrors] = useState<PromotionFormErrors>({});
  const [failure, setFailure] = useState<{
    readonly message: string;
    readonly conflict: boolean;
  } | null>(null);
  const save = useMutation({
    mutationFn: savePromotion,
    retry: false,
    onMutate: () => {
      onPendingChange(true);
    },
    onSettled: () => {
      onPendingChange(false);
    },
    onError: () => {
      setFailure({
        message:
          "Ответ не получен. Повторите то же действие: повтор не создаст вторую скидку.",
        conflict: false,
      });
    },
    onSuccess: (result, input) => {
      if (!result.ok) {
        setFailure({
          message: saveFailureMessage(result.code),
          conflict: result.code === "revision_conflict",
        });
        return;
      }
      repeat.completeOperation("save");
      onSaved(input.value.name, draft.origin === undefined);
    },
  });
  const pending = save.isPending;
  const set = <Key extends keyof PromotionFormValues>(
    key: Key,
    value: PromotionFormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const command = promotionCommand(values, draft.id, draft.origin);
        if (!command.ok) {
          setErrors(command.errors);
          return;
        }
        setErrors({});
        setFailure(null);
        const input = {
          ...(command.expectedRevision === undefined
            ? {}
            : { expectedRevision: command.expectedRevision }),
          value: command.value,
        };
        save.mutate({
          ...input,
          operationId: repeat.operationId("save", input),
        });
      }}
    >
      {failure === null ? null : (
        <AdminDialogError
          action={
            failure.conflict ? (
              <Button
                className="min-h-11 px-4"
                onClick={onRefresh}
                type="button"
                variant="outline"
              >
                Обновить данные
              </Button>
            ) : undefined
          }
        >
          {failure.message}
        </AdminDialogError>
      )}
      <TextField
        disabled={pending}
        error={errors.name}
        id={`${id}-name`}
        label="Название"
        maxLength={200}
        onChange={(value) => {
          set("name", value);
        }}
        value={values.name}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          disabled={pending}
          error={errors.percent}
          id={`${id}-percent`}
          inputMode="numeric"
          label="Скидка, %"
          onChange={(value) => {
            set("percentText", value);
          }}
          value={values.percentText}
        />
        <TextField
          disabled={pending}
          error={errors.code}
          hint="Необязательно. Без кода скидка применяется сама."
          id={`${id}-code`}
          label="Промокод"
          maxLength={100}
          onChange={(value) => {
            set("code", value);
          }}
          value={values.code}
        />
      </div>
      <AdminSearchChecklist
        disabled={pending}
        emptySelection="Ничего не выбрано: скидка действует на все продукты."
        label="Продукты"
        onValuesChange={(productIds) => {
          set("productIds", productIds);
        }}
        options={products.map((choice) => ({
          value: choice.productId,
          label: choice.name,
          detail: formatRubles(choice.priceKopecks),
        }))}
        unknownLabel="Продукт без цены"
        values={values.productIds}
        {...(errors.productIds === undefined
          ? {}
          : { error: errors.productIds })}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <DateField
          error={errors.startDate ?? ""}
          hint="С начала дня по Москве"
          label="Первый день"
          onChange={(value) => {
            set("startDate", value);
          }}
          required
          value={values.startDate}
        />
        <DateField
          error={errors.endDate ?? ""}
          hint="Включительно, до конца дня по Москве"
          label="Последний день"
          onChange={(value) => {
            set("endDate", value);
          }}
          required
          value={values.endDate}
        />
      </div>
      <TextField
        disabled={pending}
        error={errors.usageLimit}
        hint="Необязательно. Сколько покупок может получить эту скидку."
        id={`${id}-limit`}
        inputMode="numeric"
        label="Лимит применений"
        onChange={(value) => {
          set("usageLimitText", value);
        }}
        value={values.usageLimitText}
      />
      <div className="admin-dialog-footer">
        <Button
          className="min-h-11 px-4"
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Отмена
        </Button>
        <Button
          aria-busy={pending}
          className="min-h-11 px-4"
          disabled={pending}
          type="submit"
        >
          {pending
            ? "Сохраняем…"
            : draft.origin === undefined
              ? "Создать скидку"
              : "Сохранить изменения"}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  inputMode,
  maxLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
  readonly hint?: string;
  readonly disabled: boolean;
  readonly inputMode?: "numeric";
  readonly maxLength?: number;
}) {
  const describedBy = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={error !== undefined}
        autoComplete="off"
        className="admin-field-input admin-field-input-wide"
        disabled={disabled}
        id={id}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        value={value}
      />
      {hint === undefined ? null : (
        <p className="admin-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="admin-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
