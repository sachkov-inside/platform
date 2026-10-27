"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useId, useState, type ReactNode, type SubmitEvent } from "react";

import {
  cohortStageSchema,
  ownerPriceCatalogChanged,
  type BillingFailureCode,
  type ProductSalesState,
} from "@/entities/subscription";
import { formatRubles, parseRublesInput } from "@/shared/lib/moscow-format";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import {
  AdminRowMenu,
  AmountField,
  DateField,
  StateBadge,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { archiveProductPriceOperation } from "../api/archive-product-price.operation";
import { saveProductPriceOperation } from "../api/save-product-price.operation";
import { saveProductSalesStateOperation } from "../api/save-product-sales-state.operation";
import {
  deriveSaleStatus,
  priceBounds,
  priceCommand,
  productSaleQueryKey,
  saleFailureMessage,
  salesStageLabels,
  salesStateCommand,
  salesStateDraftOf,
  salesStateErrors,
  type OwnerProductPrice,
  type SalesStateDraft,
  type SalesStateErrors,
} from "../model/product-sale";
import { productSaleChanged } from "../model/product-sale-events";
import {
  ProductSaleReadError,
  useProductSale,
} from "../model/use-product-sale.client";
import { SaleConfirmDialog } from "./sale-confirm-dialog.client";

type Failure = BillingFailureCode | "lost";

interface CommandResult {
  readonly ok: boolean;
  readonly code?: BillingFailureCode;
}

export interface ProductSalePanelProps {
  readonly productId: string;
  /** Сохранённое название продукта: им называется первая цена. */
  readonly productName: string;
  readonly archived: boolean;
  /**
   * Место для ссылок на оплату этого продукта. Модуль ссылок встаёт сюда с заданным продуктом и
   * показывается под настройками продажи.
   */
  readonly paymentLinks?: ReactNode;
}

/**
 * Продажа продукта: цена, состояние продажи и открытие или закрытие продаж. Каждая запись идёт
 * существующей командой billing с ревизией, прочитанной вместе с ценой. Конфликт ревизии
 * предлагает обновить данные и никогда не отправляет команду повторно сам. Повтор после
 * потерянного ответа идёт с той же ссылкой на операцию, поэтому не выполняется дважды.
 */
export function ProductSalePanel({
  productId,
  productName,
  archived,
  paymentLinks,
}: ProductSalePanelProps) {
  const sale = useProductSale(productId);
  const cache = useQueryClient();
  const repeat = useRepeatableOperations();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"archive" | "toggle" | null>(null);

  /** Исход одной записи: успех сбрасывает факт продажи, отказ остаётся на экране. */
  const settle = (slot: string, result: CommandResult, done: string) => {
    if (!result.ok) {
      setFailure(result.code ?? "unavailable");
      // Конфликт решается перечитыванием на странице, а не повтором из диалога.
      if (result.code === "revision_conflict") setDialog(null);
      return false;
    }
    repeat.completeOperation(slot);
    setFailure(null);
    setNotice(done);
    setDialog(null);
    void cache.invalidateQueries({ queryKey: productSaleQueryKey(productId) });
    // Остальные поверхности браузера перечитывают продажу по объявлению. Новая ревизия цены
    // меняет каталог цен: выбор цены для ссылки и скидки, колонку продажи и состояние ссылок.
    productSaleChanged.announce();
    if (slot !== "state") ownerPriceCatalogChanged.announce();
    return true;
  };
  const lost = () => {
    setFailure("lost");
  };

  const savePrice = useMutation({
    mutationFn: saveProductPriceOperation.send,
    retry: false,
    onSuccess: (result) => {
      settle("price", result, "Цена сохранена.");
    },
    onError: lost,
  });
  const toggleSale = useMutation({
    mutationFn: saveProductPriceOperation.send,
    retry: false,
    onSuccess: (result) => {
      settle(
        "sale",
        result,
        result.ok && result.value.result.value.published === true
          ? "Продажи открыты."
          : "Продажи закрыты.",
      );
    },
    onError: lost,
  });
  const archivePrice = useMutation({
    mutationFn: archiveProductPriceOperation.send,
    retry: false,
    onSuccess: (result) => {
      settle("archive", result, "Цена отправлена в архив.");
    },
    onError: lost,
  });
  const saveState = useMutation({
    mutationFn: saveProductSalesStateOperation.send,
    retry: false,
    onSuccess: (result) => {
      settle("state", result, "Состояние продажи сохранено.");
    },
    onError: lost,
  });
  const pending =
    savePrice.isPending ||
    toggleSale.isPending ||
    archivePrice.isPending ||
    saveState.isPending;

  // Неудачное перечитывание после записи не прячет уже прочитанную продажу.
  if (sale.data === undefined) {
    if (!sale.isError) return <ProductSaleLoading />;
    const code =
      sale.error instanceof ProductSaleReadError
        ? sale.error.code
        : "unavailable";
    return (
      <section className="grid gap-3" role="alert">
        <h2 className="text-xl font-semibold tracking-tight">
          {code === "forbidden"
            ? "Нет доступа к продажам"
            : "Не удалось прочитать продажу"}
        </h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          {code === "forbidden"
            ? "Цену и продажи продукта меняет владелец с правом на продажи."
            : "Цена и состояние продажи сейчас недоступны. Без них сохранение будет отклонено, поэтому повторите чтение."}
        </p>
        {code === "forbidden" ? null : (
          <Button
            className="min-h-11 w-fit"
            onClick={() => {
              void sale.refetch();
            }}
            type="button"
            variant="outline"
          >
            Повторить
          </Button>
        )}
      </section>
    );
  }

  const { price, salesState } = sale.data;
  const status = deriveSaleStatus({
    productArchived: archived,
    price,
    salesState,
  });
  const conflict = failure === "revision_conflict";
  const refresh = () => {
    setFailure(null);
    setNotice(null);
    void sale.refetch();
  };

  const toggleCommand =
    price === null
      ? null
      : priceCommand({
          productId,
          productName,
          price,
          priceKopecks: price.priceKopecks,
          published: !price.published,
        });

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Сейчас</span>
        <StateBadge state={`sale.${status}`} />
      </div>
      {failure === null || dialog !== null ? null : (
        <FailureBanner failure={failure} onRefresh={refresh} />
      )}
      {notice === null ? null : (
        <p className="text-sm" role="status">
          {notice}
        </p>
      )}

      <PriceBlock
        conflict={conflict}
        key={`price:${String(price?.revision ?? 0)}`}
        onArchive={() => {
          setFailure(null);
          setDialog("archive");
        }}
        onSave={(priceKopecks) => {
          const command = priceCommand({
            productId,
            productName,
            price,
            priceKopecks,
          });
          setNotice(null);
          savePrice.mutate({
            ...command,
            operationId: repeat.operationId("price", command),
          });
        }}
        pending={pending}
        price={price}
        productName={productName}
      />

      <SalesStateBlock
        conflict={conflict}
        key={`state:${String(salesState?.revision ?? 0)}`}
        onSave={(draft) => {
          const command = salesStateCommand(productId, salesState, draft);
          setNotice(null);
          saveState.mutate({
            ...command,
            operationId: repeat.operationId("state", command),
          });
        }}
        pending={pending}
        salesState={salesState}
      />

      <SaleSwitchBlock
        archived={archived}
        conflict={conflict}
        onToggle={() => {
          setFailure(null);
          setDialog("toggle");
        }}
        pending={pending}
        price={price}
      />

      {paymentLinks}

      {price === null || toggleCommand === null ? null : (
        <SaleConfirmDialog
          confirmLabel={price.published ? "Закрыть продажи" : "Открыть продажи"}
          consequence={
            price.published ? (
              <p>
                Новые покупки и оплата по ссылкам станут недоступны. Закрытие не
                отзывает полученный доступ.
              </p>
            ) : (
              <>
                <p>
                  Покупатели смогут оплатить продукт по цене{" "}
                  {formatRubles(price.priceKopecks)}.
                </p>
                {salesState?.stage === "announcement" ? (
                  <p className="mt-2">
                    Этап «Анонс» оплату не принимает: кнопка оплаты появится
                    после смены этапа.
                  </p>
                ) : null}
              </>
            )
          }
          error={
            dialog === "toggle" && failure !== null
              ? failureText(failure)
              : null
          }
          onConfirm={() => {
            setNotice(null);
            toggleSale.mutate({
              ...toggleCommand,
              operationId: repeat.operationId("sale", toggleCommand),
            });
          }}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          open={dialog === "toggle"}
          pending={toggleSale.isPending}
          title={price.published ? "Закрыть продажи?" : "Открыть продажи?"}
          tone={price.published ? "danger" : "default"}
        />
      )}
      {price === null ? null : (
        <SaleConfirmDialog
          confirmLabel="Архивировать цену"
          consequence={
            <p>
              Продажи продукта закроются. Полученный доступ и прежние покупки
              сохранятся. Архив необратим: вернуть цену или задать новую из
              админки нельзя.
            </p>
          }
          error={
            dialog === "archive" && failure !== null
              ? failureText(failure)
              : null
          }
          onConfirm={() => {
            const command = { id: productId, expectedRevision: price.revision };
            setNotice(null);
            archivePrice.mutate({
              ...command,
              operationId: repeat.operationId("archive", command),
            });
          }}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          open={dialog === "archive"}
          pending={archivePrice.isPending}
          title="Архивировать цену?"
          tone="danger"
        />
      )}
    </div>
  );
}

function failureText(failure: Failure): string {
  return failure === "lost"
    ? "Ответ не дошёл. Повторите то же действие: запись не выполнится дважды."
    : saleFailureMessage(failure);
}

function FailureBanner({
  failure,
  onRefresh,
}: {
  readonly failure: Failure;
  readonly onRefresh: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/35 bg-destructive/5 p-3 text-sm"
      role="alert"
    >
      <CircleAlert
        aria-hidden="true"
        className="size-4 shrink-0 text-destructive"
      />
      <span className="min-w-0 flex-1">{failureText(failure)}</span>
      {failure === "revision_conflict" ? (
        <Button
          className="min-h-11"
          onClick={onRefresh}
          type="button"
          variant="outline"
        >
          Обновить данные
        </Button>
      ) : null}
    </div>
  );
}

function BlockHeading({
  id,
  title,
  description,
  action,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight" id={id}>
          {title}
        </h2>
        <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function PriceBlock({
  price,
  productName,
  pending,
  conflict,
  onSave,
  onArchive,
}: {
  readonly price: OwnerProductPrice | null;
  readonly productName: string;
  readonly pending: boolean;
  readonly conflict: boolean;
  readonly onSave: (priceKopecks: number) => void;
  readonly onArchive: () => void;
}) {
  const headingId = useId();
  const [kopecks, setKopecks] = useState<number | null>(
    price?.priceKopecks ?? null,
  );
  const [error, setError] = useState<string>();
  const unchanged = kopecks === price?.priceKopecks;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || conflict) return;
    if (
      kopecks === null ||
      kopecks < priceBounds.min ||
      kopecks > priceBounds.max
    ) {
      setError("Укажите цену от 1 до 1 000 000 ₽");
      return;
    }
    setError(undefined);
    onSave(kopecks);
  };
  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <BlockHeading
        action={
          price === null ? null : (
            <AdminRowMenu
              items={[
                {
                  id: "archive",
                  label: "Архивировать цену",
                  tone: "danger",
                  disabled: pending,
                  onSelect: onArchive,
                },
              ]}
              label={`Действия с ценой «${productName}»`}
            />
          )
        }
        description={
          price === null
            ? "У продукта ещё нет цены. Цена сохранится без открытия продаж."
            : "Одна разовая цена продукта. Новая цена не меняет уже начатые покупки."
        }
        id={headingId}
        title="Цена"
      />
      <form className="grid gap-4" noValidate onSubmit={submit}>
        <AmountField
          error={error ?? ""}
          label="Цена"
          max={priceBounds.max}
          min={priceBounds.min}
          onChange={(value) => {
            setKopecks(value);
            if (error !== undefined) setError(undefined);
          }}
          required
          valueKopecks={kopecks}
        />
        <Button
          aria-busy={pending}
          className="min-h-11 w-full sm:w-fit"
          disabled={pending || conflict || unchanged}
          type="submit"
        >
          Сохранить цену
        </Button>
      </form>
    </section>
  );
}

function SalesStateBlock({
  salesState,
  pending,
  conflict,
  onSave,
}: {
  readonly salesState: ProductSalesState | null;
  readonly pending: boolean;
  readonly conflict: boolean;
  readonly onSave: (draft: SalesStateDraft) => void;
}) {
  const headingId = useId();
  const stageId = useId();
  const [draft, setDraft] = useState(() => salesStateDraftOf(salesState));
  const [errors, setErrors] = useState<SalesStateErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const edit = (next: Partial<SalesStateDraft>) => {
    const value = { ...draft, ...next };
    setDraft(value);
    if (submitted) setErrors(salesStateErrors(value));
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || conflict) return;
    const found = salesStateErrors(draft);
    setSubmitted(true);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave(draft);
  };
  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <BlockHeading
        description="Этап, поток и дата старта видны на странице продукта сразу после сохранения. Анонс никогда не принимает оплату. На остальных этапах кнопка оплаты видна, только пока продажи открыты."
        id={headingId}
        title="Состояние продажи"
      />
      <form className="grid max-w-xl gap-5" noValidate onSubmit={submit}>
        <fieldset
          aria-labelledby={stageId}
          className="admin-reasons"
          role="radiogroup"
        >
          <legend id={stageId}>Этап</legend>
          {cohortStageSchema.options.map((stage) => (
            <label className="admin-reason" key={stage}>
              <input
                checked={draft.stage === stage}
                name={`${headingId}-stage`}
                onChange={() => {
                  edit({ stage });
                }}
                type="radio"
                value={stage}
              />
              {salesStageLabels[stage]}
            </label>
          ))}
        </fieldset>
        <SaleTextField
          error={errors.name}
          hint="Стоит на плашке как метка: «Поток 1», «Второй поток»."
          label="Название потока"
          maxLength={120}
          onChange={(name) => {
            edit({ name });
          }}
          value={draft.name}
        />
        <DateField
          error={errors.startsOn ?? ""}
          hint="ДД.ММ.ГГГГ. Нужна всем этапам, кроме «Между потоками»."
          label="Дата старта"
          onChange={(startsOn) => {
            edit({ startsOn });
          }}
          required={draft.stage !== "between"}
          value={draft.startsOn}
        />
        <SaleTextField
          error={errors.nextEvent}
          hint="Для этапа «Между потоками»: например, «эфир 15 декабря»."
          label="Событие следующего потока"
          maxLength={200}
          onChange={(nextEvent) => {
            edit({ nextEvent });
          }}
          value={draft.nextEvent}
        />
        <PriceAfterStartField
          error={errors.priceAfterStart}
          onChange={(priceAfterStartKopecks, priceAfterStartInvalid) => {
            edit({ priceAfterStartKopecks, priceAfterStartInvalid });
          }}
          valueKopecks={draft.priceAfterStartKopecks}
        />
        <Button
          aria-busy={pending}
          className="min-h-11 w-full sm:w-fit"
          disabled={pending || conflict}
          type="submit"
        >
          Сохранить состояние продажи
        </Button>
      </form>
    </section>
  );
}

/**
 * Цена после старта только показывается зачёркнутой рядом с ценой предзаказа; списание идёт по
 * цене продукта. Пустое поле значит «не показывать», поэтому нечитаемый текст отличается от пустого.
 */
function PriceAfterStartField({
  valueKopecks,
  error,
  onChange,
}: {
  readonly valueKopecks: number | null;
  readonly error: string | undefined;
  readonly onChange: (kopecks: number | null, invalid: boolean) => void;
}) {
  return (
    <div
      onInput={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        // Поле суммы отдаёт `null` и для пустого, и для нечитаемого текста: здесь они различаются.
        const text = target.value;
        const kopecks = parseRublesInput(text);
        onChange(kopecks, kopecks === null && text.trim() !== "");
      }}
    >
      <AmountField
        error={error ?? ""}
        hint="Страница продукта покажет её зачёркнутой рядом с ценой предзаказа. Списание идёт по цене продукта: в день старта поменяйте её в блоке «Цена». Пустое поле: не показывать."
        label="Цена после старта"
        onChange={(kopecks) => {
          // Пустой и нечитаемый текст различает обёртка выше; верная сумма приходит и отсюда.
          if (kopecks !== null) onChange(kopecks, false);
        }}
        valueKopecks={valueKopecks}
      />
    </div>
  );
}

function SaleSwitchBlock({
  price,
  archived,
  pending,
  conflict,
  onToggle,
}: {
  readonly price: OwnerProductPrice | null;
  readonly archived: boolean;
  readonly pending: boolean;
  readonly conflict: boolean;
  readonly onToggle: () => void;
}) {
  const headingId = useId();
  const published = price?.published === true;
  const description =
    price === null
      ? "Сначала задайте цену: без неё продавать нечего."
      : published
        ? "Продажи открыты: покупатели могут оплатить продукт. Закрытие не отзывает полученный доступ."
        : archived
          ? "Продукт в архиве: новые покупки закрыты, открыть продажи нельзя."
          : "Продажи закрыты: оплата не принимается, полученный доступ сохраняется.";
  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <BlockHeading description={description} id={headingId} title="Продажи" />
      <Button
        aria-busy={pending}
        className="min-h-11 w-full sm:w-fit"
        disabled={
          price === null || pending || conflict || (archived && !published)
        }
        onClick={onToggle}
        type="button"
        variant={published ? "outline" : "default"}
      >
        {published ? "Закрыть продажи" : "Открыть продажи"}
      </Button>
    </section>
  );
}

function SaleTextField({
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
}: {
  readonly label: string;
  readonly hint: string;
  readonly error: string | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength: number;
}) {
  const id = useId();
  const describedBy = [`${id}-hint`, error === undefined ? null : `${id}-error`]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={describedBy}
        aria-invalid={error !== undefined}
        autoComplete="off"
        className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive md:text-sm"
        id={id}
        maxLength={maxLength}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        type="text"
        value={value}
      />
      <p className="admin-field-hint" id={`${id}-hint`}>
        {hint}
      </p>
      {error === undefined ? null : (
        <p className="admin-field-error" id={`${id}-error`}>
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Загрузка в раскладке готовой вкладки: те же три блока, без прыжка разметки. */
function ProductSaleLoading() {
  return (
    <div aria-busy="true" className="grid gap-10">
      <p className="sr-only" role="status">
        Загружаем продажу
      </p>
      {[0, 1, 2].map((block) => (
        <div aria-hidden="true" className="grid gap-4" key={block}>
          <span className="admin-skeleton-bar h-6 w-40" />
          <span className="admin-skeleton-bar h-4 w-full max-w-md" />
          <span className="admin-skeleton-bar h-11 w-56" />
        </div>
      ))}
    </div>
  );
}
