"use client";

import { LoaderCircle } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type SubmitEvent,
} from "react";

import { Button } from "@/shared/ui/button";

import {
  encodeAccessReason,
  grantReasons,
  otherReason,
  reasonNoteMaxCharacters,
} from "../model/access-reasons";
import {
  accessProductLabel,
  type AccessProduct,
} from "../model/product-catalog";
import type { AccessProductCatalogView } from "../model/use-access-product-catalog.client";
import {
  AccessDialog,
  AccessDialogError,
  AccessFieldError,
} from "./access-dialog.client";

/** Доступ человека к продукту по данным карточки: от него зависит подсказка в форме. */
export type HeldAccess = "active" | "revoked";

export interface GrantProductDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Кому выдаём: подпись человека из шапки карточки. */
  readonly personTitle: string;
  readonly catalog: AccessProductCatalogView;
  /** Продукты человека по карточке; `null`, если блок продуктов не прочитался. */
  readonly held: ReadonlyMap<string, HeldAccess> | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onConfirm: (input: {
    readonly product: AccessProduct;
    readonly reason: string;
  }) => void;
  /** Отозванный продукт не выдают заново: форма предлагает восстановить его. */
  readonly onRestoreInstead: (productId: string) => void;
}

/**
 * «Выдать продукт» (#1721): выбор продукта из каталога и причины. Форма заранее говорит, что
 * выдача уже выданного продукта ничего не изменит, а для отозванного предлагает «Восстановить».
 * Правило решает Product Access; форма только называет, что показывает карточка.
 */
export function GrantProductDialog(props: GrantProductDialogProps) {
  const headingId = useId();
  return (
    <AccessDialog
      labelledBy={headingId}
      onOpenChange={props.onOpenChange}
      open={props.open}
      pending={props.pending}
    >
      <GrantForm {...props} headingId={headingId} />
    </AccessDialog>
  );
}

function GrantForm({
  catalog,
  error,
  headingId,
  held,
  onConfirm,
  onOpenChange,
  onRestoreInstead,
  pending,
  personTitle,
}: GrantProductDialogProps & { readonly headingId: string }) {
  const id = useId();
  const firstProduct = useRef<HTMLInputElement>(null);
  const firstReason = useRef<HTMLInputElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const products = catalog.kind === "ready" ? catalog.products : [];
  const product = products.find((entry) => entry.productId === productId);
  const access =
    product === undefined ? undefined : held?.get(product.productId);
  const encoded = encodeAccessReason(grantReasons, { note: noteText, reason });
  const productError = product === undefined ? "Выберите продукт" : null;
  const reasonError =
    !encoded.ok && encoded.error === "reason_required"
      ? "Выберите причину"
      : null;
  const noteError =
    !encoded.ok && encoded.error === "note_required" ? "Опишите причину" : null;

  useEffect(() => {
    firstProduct.current?.focus();
  }, [catalog.kind]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (product === undefined) {
      firstProduct.current?.focus();
      return;
    }
    if (access === "revoked") {
      onRestoreInstead(product.productId);
      return;
    }
    if (!encoded.ok) {
      if (encoded.error === "reason_required") firstReason.current?.focus();
      else note.current?.focus();
      return;
    }
    onConfirm({ product, reason: encoded.text });
  };

  const productLegendId = `${id}-product`;
  const productErrorId = `${id}-product-error`;
  const productHintId = `${id}-product-hint`;
  const reasonLegendId = `${id}-reason`;
  const reasonErrorId = `${id}-reason-error`;
  const noteId = `${id}-note`;
  const noteErrorId = `${id}-note-error`;
  const shownProductError = submitted ? productError : null;
  const shownReasonError = submitted ? reasonError : null;
  const shownNoteError = submitted ? noteError : null;
  const noteRequired = reason === otherReason;

  return (
    <form className="admin-dialog-body" noValidate onSubmit={submit}>
      <div>
        <h2 id={headingId}>Выдать продукт</h2>
        <p className="admin-dialog-consequence">
          Кому:{" "}
          <span className="font-medium text-foreground">{personTitle}</span>.
          Доступ бессрочный; его можно отозвать в карточке.
        </p>
      </div>
      <AccessDialogError message={error} />
      <fieldset
        aria-describedby={describedBy([
          shownProductError === null ? null : productErrorId,
          access === undefined ? null : productHintId,
        ])}
        aria-invalid={shownProductError !== null}
        aria-labelledby={productLegendId}
        aria-required="true"
        className="admin-reasons"
        disabled={pending}
        role="radiogroup"
      >
        <legend id={productLegendId}>Продукт</legend>
        <CatalogChoices
          catalog={catalog}
          firstProduct={firstProduct}
          held={held}
          name={`${id}-product`}
          onChange={setProductId}
          selected={productId}
        />
        {shownProductError === null ? null : (
          <AccessFieldError id={productErrorId}>
            {shownProductError}
          </AccessFieldError>
        )}
        {product === undefined || access === undefined ? null : (
          <p className="admin-field-hint" id={productHintId}>
            {access === "active"
              ? `У человека уже есть доступ к «${product.name}». Выдача ничего не изменит.`
              : `Доступ к «${product.name}» был отозван. Выдача его не вернёт: доступ возвращает «Восстановить».`}
          </p>
        )}
        {held === null ? (
          <p className="admin-field-hint">
            Продукты человека сейчас не прочитались. Если доступ уже есть,
            выдача ничего не изменит.
          </p>
        ) : null}
      </fieldset>
      {access === "revoked" ? null : (
        <>
          <fieldset
            aria-describedby={
              shownReasonError === null ? undefined : reasonErrorId
            }
            aria-invalid={shownReasonError !== null}
            aria-labelledby={reasonLegendId}
            aria-required="true"
            className="admin-reasons"
            disabled={pending}
            role="radiogroup"
          >
            <legend id={reasonLegendId}>Причина</legend>
            {grantReasons.map((option, index) => (
              <label className="admin-reason" key={option.value}>
                <input
                  checked={reason === option.value}
                  name={`${id}-reason`}
                  onChange={() => {
                    setReason(option.value);
                  }}
                  ref={index === 0 ? firstReason : undefined}
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
            {shownReasonError === null ? null : (
              <AccessFieldError id={reasonErrorId}>
                {shownReasonError}
              </AccessFieldError>
            )}
          </fieldset>
          <div className="admin-field">
            <label className="admin-field-label" htmlFor={noteId}>
              Заметка
              {noteRequired ? null : (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  (необязательно)
                </span>
              )}
            </label>
            <textarea
              aria-describedby={
                shownNoteError === null ? undefined : noteErrorId
              }
              aria-invalid={shownNoteError !== null}
              className="admin-field-textarea"
              disabled={pending}
              id={noteId}
              maxLength={reasonNoteMaxCharacters(grantReasons)}
              onChange={(event) => {
                setNoteText(event.currentTarget.value);
              }}
              ref={note}
              required={noteRequired}
              value={noteText}
            />
            {shownNoteError === null ? null : (
              <AccessFieldError id={noteErrorId}>
                {shownNoteError}
              </AccessFieldError>
            )}
          </div>
        </>
      )}
      <div className="admin-dialog-footer">
        <Button
          className="min-h-11 px-4"
          disabled={pending}
          onClick={() => {
            onOpenChange(false);
          }}
          type="button"
          variant="outline"
        >
          Отмена
        </Button>
        <Button
          aria-busy={pending}
          className="min-h-11 px-4"
          disabled={pending || catalog.kind !== "ready"}
          type="submit"
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {access === "revoked" ? "Перейти к восстановлению" : "Выдать продукт"}
        </Button>
      </div>
    </form>
  );
}

function CatalogChoices({
  catalog,
  firstProduct,
  held,
  name,
  onChange,
  selected,
}: {
  readonly catalog: AccessProductCatalogView;
  readonly firstProduct: RefObject<HTMLInputElement | null>;
  readonly held: ReadonlyMap<string, HeldAccess> | null;
  readonly name: string;
  readonly onChange: (productId: string) => void;
  readonly selected: string;
}) {
  if (catalog.kind === "loading")
    return (
      <p className="admin-field-hint" role="status">
        Загружаем продукты…
      </p>
    );
  if (catalog.kind !== "ready")
    return (
      <p className="admin-field-hint" role="alert">
        {catalog.kind === "forbidden"
          ? "Список продуктов открыт аккаунту с правом управлять доступом и оплатами."
          : catalog.kind === "signed_out"
            ? "Сессия завершилась. Войдите снова, чтобы выдать продукт."
            : "Список продуктов сейчас не загрузился. Закройте окно и повторите позже."}
      </p>
    );
  if (catalog.products.length === 0)
    return <p className="admin-field-hint">Продуктов пока нет.</p>;
  return catalog.products.map((product, index) => {
    const access = held?.get(product.productId);
    return (
      <label className="admin-reason" key={product.productId}>
        <input
          checked={selected === product.productId}
          name={name}
          onChange={() => {
            onChange(product.productId);
          }}
          ref={index === 0 ? firstProduct : undefined}
          type="radio"
          value={product.productId}
        />
        <span className="min-w-0">
          {accessProductLabel(product)}
          {access === undefined ? null : (
            <>
              {" "}
              <span className="text-muted-foreground">
                {access === "active" ? "· уже выдан" : "· отозван"}
              </span>
            </>
          )}
        </span>
      </label>
    );
  });
}

/** Связь поля с его ошибкой и подсказкой; без них атрибута нет. */
function describedBy(ids: readonly (string | null)[]): string | undefined {
  const present = ids.filter((value) => value !== null);
  return present.length === 0 ? undefined : present.join(" ");
}
