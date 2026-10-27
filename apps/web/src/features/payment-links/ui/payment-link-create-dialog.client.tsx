"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import type { PaymentLink, ProductPriceChoice } from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { formatMoscowDate, formatRubles } from "@/shared/lib/moscow-format";
import {
  AdminDialog,
  AdminDialogError,
  AdminSearchSelect,
  AmountField,
  DateField,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { createPaymentLink } from "../api/payment-links.browser";
import { paymentLinkExpiresAt } from "../model/payment-link-expiry";
import {
  paymentLinkMaxKopecks,
  paymentLinkMinKopecks,
  paymentLinkPricePreview,
  type PaymentLinkPriceDraft,
} from "../model/payment-link-price";
import { createFailureMessage } from "../model/payment-links-presentation";
import { PaymentLinkShare } from "./payment-link-share.client";

/** Каталог цен для выбора продукта: пока читается, недоступен или готов. */
export type ProductChoicesState =
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable"; readonly onRetry: () => void }
  | { readonly kind: "ready"; readonly choices: readonly ProductPriceChoice[] };

type PriceMode = PaymentLinkPriceDraft["kind"];

const priceModes: readonly {
  readonly value: PriceMode;
  readonly label: string;
}[] = [
  { value: "product", label: "Как у продукта" },
  { value: "amount", label: "Сумма, ₽" },
  { value: "discount", label: "Скидка, %" },
];

/**
 * Создание ссылки на оплату: на телефоне лист снизу, на компьютере диалог. Владелец выбирает
 * продукт (на странице продукта он задан), цену и необязательный срок, видит итог до создания,
 * а после создания копирует ссылку или делится ею.
 */
export function PaymentLinkCreateDialog({
  open,
  onOpenChange,
  products,
  fixedProductId,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly products: ProductChoicesState;
  /** Продукт задан страницей продукта: выбора нет. */
  readonly fixedProductId?: string | undefined;
  readonly onCreated: (link: PaymentLink) => void;
}) {
  const [created, setCreated] = useState<PaymentLink | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <AdminDialog
      description={
        created === null
          ? "Публичная цена продукта не меняется. Ссылка одноразовая: по ней можно оплатить один раз."
          : undefined
      }
      onOpenChange={(next) => {
        if (!next) setCreated(null);
        onOpenChange(next);
      }}
      open={open}
      pending={pending}
      title={created === null ? "Новая ссылка на оплату" : "Ссылка создана"}
    >
      {created === null ? (
        <CreateForm
          fixedProductId={fixedProductId}
          onCancel={() => {
            onOpenChange(false);
          }}
          onCreated={(link) => {
            setCreated(link);
            onCreated(link);
          }}
          onPendingChange={setPending}
          products={products}
        />
      ) : (
        <PaymentLinkShare
          link={created}
          onDone={() => {
            setCreated(null);
            onOpenChange(false);
          }}
        />
      )}
    </AdminDialog>
  );
}

function CreateForm({
  products,
  fixedProductId,
  onCancel,
  onCreated,
  onPendingChange,
}: {
  readonly products: ProductChoicesState;
  readonly fixedProductId: string | undefined;
  readonly onCancel: () => void;
  readonly onCreated: (link: PaymentLink) => void;
  readonly onPendingChange: (pending: boolean) => void;
}) {
  const id = useId();
  const repeat = useRepeatableOperations();
  const choices = products.kind === "ready" ? products.choices : [];
  const [productId, setProductId] = useState(fixedProductId ?? "");
  const [mode, setMode] = useState<PriceMode>("product");
  const [amountKopecks, setAmountKopecks] = useState<number | null>(null);
  const [percentText, setPercentText] = useState("10");
  const [expiry, setExpiry] = useState("");
  const [expiryError, setExpiryError] = useState("");
  const [productError, setProductError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const selected = choices.find((choice) => choice.productId === productId);
  const draft: PaymentLinkPriceDraft =
    mode === "amount"
      ? { kind: "amount", amountKopecks }
      : mode === "discount"
        ? { kind: "discount", percentText }
        : { kind: "product" };
  const preview =
    selected === undefined
      ? null
      : paymentLinkPricePreview(selected.snapshot, draft);
  const create = useMutation({
    mutationFn: createPaymentLink,
    retry: false,
    onMutate: () => {
      onPendingChange(true);
    },
    onSettled: () => {
      onPendingChange(false);
    },
    onError: () => {
      setFailure(
        "Ответ не получен. Повторите то же действие: повтор не создаст вторую ссылку.",
      );
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setFailure(createFailureMessage(result.code));
        return;
      }
      repeat.completeOperation("create");
      setFailure(null);
      onCreated(result.value.result.value);
    },
  });
  const pending = create.isPending;

  if (products.kind === "pending")
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Загружаем продукты и цены…
      </p>
    );
  if (products.kind === "unavailable")
    return (
      <AdminDialogError
        action={
          <Button
            className="min-h-11 px-4"
            onClick={products.onRetry}
            type="button"
            variant="outline"
          >
            Повторить
          </Button>
        }
      >
        Не удалось загрузить продукты и цены. Ссылку можно создать, когда они
        загрузятся.
      </AdminDialogError>
    );
  if (fixedProductId !== undefined && selected === undefined)
    return (
      <p className="text-sm leading-6" role="status">
        У продукта нет действующей цены. Задайте цену во вкладке «Продажа», и
        здесь можно будет создать ссылку.
      </p>
    );
  if (choices.length === 0)
    return (
      <p className="text-sm leading-6" role="status">
        Ни у одного продукта нет действующей цены. Задайте цену на странице
        продукта во вкладке «Продажа».
      </p>
    );

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        setSubmitted(true);
        if (selected === undefined) {
          setProductError("Выберите продукт");
          return;
        }
        setProductError("");
        const expiresAt = paymentLinkExpiresAt(expiry, new Date());
        setExpiryError(expiresAt.ok ? "" : expiresAt.error);
        if (preview === null || !preview.valid || !expiresAt.ok) return;
        const input = {
          productId: selected.productId,
          priceRevision: selected.priceRevision,
          price: preview.price,
          expiresAt: expiresAt.expiresAt,
        };
        setFailure(null);
        create.mutate({
          ...input,
          operationId: repeat.operationId("create", input),
        });
      }}
    >
      {failure === null ? null : <AdminDialogError>{failure}</AdminDialogError>}
      {fixedProductId === undefined ? (
        <AdminSearchSelect
          disabled={pending}
          error={productError}
          label="Продукт"
          onValueChange={(value) => {
            setProductId(value);
            setProductError("");
          }}
          options={choices.map((choice) => ({
            value: choice.productId,
            label: choice.name,
            detail: formatRubles(choice.priceKopecks),
          }))}
          placeholder="Выберите продукт"
          value={productId}
        />
      ) : selected === undefined ? null : (
        <p className="grid gap-0.5 text-sm">
          <span className="admin-field-label">Продукт</span>
          <span>
            {selected.name} · {formatRubles(selected.priceKopecks)}
          </span>
        </p>
      )}
      <fieldset className="grid gap-2" disabled={pending}>
        <legend className="admin-field-label mb-1.5">Цена по ссылке</legend>
        <div className="grid gap-1 sm:grid-cols-3">
          {priceModes.map((option) => (
            <label className="admin-checklist-item" key={option.value}>
              <input
                checked={mode === option.value}
                name={`${id}-mode`}
                onChange={() => {
                  setMode(option.value);
                }}
                type="radio"
                value={option.value}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {mode === "amount" ? (
        <AmountField
          error={
            submitted && preview !== null && !preview.valid ? preview.error : ""
          }
          label="Сумма к оплате"
          max={paymentLinkMaxKopecks}
          min={paymentLinkMinKopecks}
          onChange={setAmountKopecks}
          required
          valueKopecks={amountKopecks}
        />
      ) : null}
      {mode === "discount" ? (
        <PercentField
          error={
            submitted && preview !== null && !preview.valid ? preview.error : ""
          }
          onChange={setPercentText}
          pending={pending}
          value={percentText}
        />
      ) : null}
      <DateField
        error={expiryError}
        hint="Необязательно. Ссылка действует по этот день включительно, по московскому времени. Без даты она действует до оплаты или отзыва."
        label="Действует по"
        onChange={(value) => {
          setExpiry(value);
          setExpiryError("");
        }}
        value={expiry}
      />
      {preview === null || selected === undefined ? null : (
        <PricePreview
          base={selected.priceKopecks}
          expiresLabel={expiryPreview(expiry)}
          price={preview.valid ? preview.preview.firstPriceKopecks : null}
        />
      )}
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
          {pending ? "Создаём…" : "Создать ссылку"}
        </Button>
      </div>
    </form>
  );
}

function expiryPreview(date: string): string {
  return date === ""
    ? "Без срока: до оплаты или отзыва"
    : `Действует по ${formatMoscowDate(date)} включительно`;
}

function PercentField({
  value,
  onChange,
  error,
  pending,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string;
  readonly pending: boolean;
}) {
  const id = useId();
  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        <span aria-hidden="true">Скидка</span>
        <span className="sr-only">Скидка, %</span>
      </label>
      <div className="admin-field-control">
        <input
          aria-describedby={
            error === "" ? `${id}-hint` : `${id}-hint ${id}-error`
          }
          aria-invalid={error !== ""}
          autoComplete="off"
          className="admin-field-input max-w-[8rem]"
          disabled={pending}
          id={id}
          inputMode="numeric"
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          value={value}
        />
        <span aria-hidden="true" className="admin-field-suffix">
          %
        </span>
      </div>
      <p className="admin-field-hint" id={`${id}-hint`}>
        Целое число от 0 до 99 от цены продукта.
      </p>
      {error === "" ? null : (
        <p className="admin-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function PricePreview({
  price,
  base,
  expiresLabel,
}: {
  readonly price: number | null;
  readonly base: number;
  readonly expiresLabel: string;
}) {
  return (
    <section
      aria-label="Итог по ссылке"
      className="grid gap-1 rounded-xl border border-border bg-background p-4"
      data-payment-link-preview
    >
      <p className="text-sm text-muted-foreground">Покупатель заплатит</p>
      <p aria-live="polite" className="text-2xl font-semibold tabular-nums">
        {price === null ? "Проверьте цену" : formatRubles(price)}
      </p>
      {price !== null && price < base ? (
        <p className="text-sm text-muted-foreground">
          Обычная цена <s>{formatRubles(base)}</s>
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">{expiresLabel}</p>
    </section>
  );
}
