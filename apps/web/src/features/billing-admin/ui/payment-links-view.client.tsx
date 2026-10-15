"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import {
  PaymentLinkSummary,
  formatKopecks,
  paymentLinkHref,
  paymentLinkStateLabels,
  type PaymentLink,
  type PriceSnapshot,
} from "@/entities/subscription";
import type { CreatePaymentLinkInput } from "../model/payment-link-operations";
import styles from "./payment-links.module.css";

export interface PaymentLinksViewProps {
  readonly offers: readonly PriceSnapshot[];
  readonly titleFor: (snapshot: PriceSnapshot) => string;
  readonly links: readonly PaymentLink[];
  readonly issued: PaymentLink | null;
  readonly loading: boolean;
  readonly pending: boolean;
  readonly error?: string | undefined;
  readonly listError?: string | undefined;
  readonly message?: string | undefined;
  readonly hasNext: boolean;
  readonly onCreate: (
    input: Omit<CreatePaymentLinkInput, "operationId">,
  ) => void;
  readonly onRevoke: (link: PaymentLink) => void;
  readonly onRefresh: () => void;
  readonly onMore: () => void;
}
export function PaymentLinksView({
  offers,
  titleFor,
  links,
  issued,
  loading,
  pending,
  error,
  listError,
  message,
  hasNext,
  onCreate,
  onRevoke,
  onRefresh,
  onMore,
}: PaymentLinksViewProps) {
  const prefix = useId();
  const [optionId, setOptionId] = useState("");
  const [mode, setMode] = useState<"discount" | "amount">("discount");
  const [text, setText] = useState("10");
  const [expiration, setExpiration] = useState("");
  const [localError, setLocalError] = useState("");
  const selected =
    offers.find((offer) => offer.paymentOption.id === optionId) ?? offers[0];
  const numeric = /^\d+(?:[.,]\d{1,2})?$/.test(text)
    ? Number(text.replace(",", "."))
    : NaN;
  const amount =
    selected === undefined
      ? NaN
      : mode === "amount"
        ? Math.round(numeric * 100)
        : Math.round(
            (selected.paymentOption.priceKopecks * (100 - numeric)) / 100,
          );
  const valid =
    Number.isSafeInteger(amount) &&
    amount >= 100 &&
    amount <= 100_000_000 &&
    (mode === "amount" ||
      (Number.isInteger(numeric) && numeric >= 0 && numeric <= 99));
  const preview =
    selected === undefined
      ? null
      : {
          ...selected,
          firstPriceKopecks: valid ? amount : selected.firstPriceKopecks,
        };
  function create() {
    setLocalError("");
    if (selected === undefined || !valid) {
      setLocalError(
        "Укажите сумму от 1 до 1 000 000 ₽ или целую скидку от 0 до 99%. Бесплатный доступ выдайте через назначение доступа.",
      );
      return;
    }
    const expiresAt =
      expiration === "" ? null : new Date(`${expiration}:00+03:00`);
    if (
      expiresAt !== null &&
      (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    ) {
      setLocalError("Укажите будущую дату окончания действия ссылки.");
      return;
    }
    onCreate({
      paymentOptionId: selected.paymentOption.id,
      optionRevision: selected.paymentOption.revision,
      price:
        mode === "discount"
          ? { kind: "discount", percent: numeric }
          : { kind: "amount", amountKopecks: amount },
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  }
  return (
    <section
      id="payment-links"
      className={styles["root"]}
      aria-labelledby={`${prefix}-heading`}
    >
      <header className={styles["header"]}>
        <div>
          <h2 id={`${prefix}-heading`}>Ссылки на оплату</h2>
          <p>
            Выберите продукт и согласованную цену. Публичная цена останется
            прежней.
          </p>
        </div>
      </header>
      {offers.length === 0 ? (
        <p role="status">
          Для ссылки нужен продукт с разовым вариантом оплаты. Добавьте его в
          каталог выше.
        </p>
      ) : (
        <div className={styles["workspace"]}>
          <form
            className={styles["form"]}
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <label htmlFor={`${prefix}-product`}>Продукт</label>
            <select
              id={`${prefix}-product`}
              value={selected?.paymentOption.id ?? ""}
              onChange={(event) => {
                setOptionId(event.target.value);
              }}
              disabled={pending}
            >
              {offers.map((offer) => (
                <option
                  key={offer.paymentOption.id}
                  value={offer.paymentOption.id}
                >
                  {titleFor(offer)} · {offer.offer.name} ·{" "}
                  {formatKopecks(offer.paymentOption.priceKopecks)}
                </option>
              ))}
            </select>
            <fieldset disabled={pending}>
              <legend>Цена по ссылке</legend>
              <label>
                <input
                  type="radio"
                  name={`${prefix}-mode`}
                  checked={mode === "discount"}
                  onChange={() => {
                    setMode("discount");
                    setText("10");
                  }}
                />{" "}
                Скидка, %
              </label>
              <label>
                <input
                  type="radio"
                  name={`${prefix}-mode`}
                  checked={mode === "amount"}
                  onChange={() => {
                    setMode("amount");
                    setText(
                      selected === undefined
                        ? ""
                        : String(selected.paymentOption.priceKopecks / 100),
                    );
                  }}
                />{" "}
                Итоговая сумма, ₽
              </label>
            </fieldset>
            <label htmlFor={`${prefix}-value`}>
              {mode === "discount" ? "Размер скидки, %" : "Сумма к оплате, ₽"}
            </label>
            <input
              id={`${prefix}-value`}
              required
              inputMode={mode === "discount" ? "numeric" : "decimal"}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              disabled={pending}
              aria-describedby={`${prefix}-help`}
            />
            <p id={`${prefix}-help`}>
              Анкетную скидку владелец проверяет вручную. Бесплатный доступ
              выдайте через назначение доступа.
            </p>
            <label htmlFor={`${prefix}-expiry`}>
              Действует до, Москва · необязательно
            </label>
            <input
              id={`${prefix}-expiry`}
              type="datetime-local"
              value={expiration}
              onChange={(event) => {
                setExpiration(event.target.value);
              }}
              disabled={pending}
            />
            <p>
              Без даты ссылка действует до одной успешной покупки или отзыва.
            </p>
            <Button type="submit" disabled={pending}>
              {pending ? "Сохраняем…" : "Создать ссылку"}
            </Button>
          </form>
          {preview !== null && (
            <PaymentLinkSummary snapshot={preview} title={titleFor(preview)} />
          )}
        </div>
      )}
      {(localError !== "" || error !== undefined) && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {localError !== "" ? localError : error}
        </p>
      )}
      {message !== undefined && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}
      {issued !== null && (
        <div className={styles["issued"]}>
          <h3 className="mb-4 text-xl font-semibold">Ссылка создана</h3>
          <PaymentLinkRow
            link={links.find((link) => link.id === issued.id) ?? issued}
            title={titleFor(issued.snapshot)}
            pending={pending}
            onRevoke={onRevoke}
          />
        </div>
      )}
      <div className={styles["list"]}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">Выданные ссылки</h3>
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            Обновить список
          </Button>
        </div>
        {listError !== undefined && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {listError}
          </p>
        )}
        {loading && links.length === 0 ? (
          <p role="status">Загружаем ссылки…</p>
        ) : links.length === 0 ? (
          listError === undefined ? (
            <p>Выданных ссылок пока нет.</p>
          ) : null
        ) : (
          links.map((link) => (
            <PaymentLinkRow
              key={link.id}
              link={link}
              title={titleFor(link.snapshot)}
              pending={pending}
              onRevoke={onRevoke}
            />
          ))
        )}
        {hasNext && (
          <Button
            className="mt-4"
            variant="outline"
            onClick={onMore}
            disabled={loading}
          >
            Показать ещё
          </Button>
        )}
      </div>
    </section>
  );
}
function PaymentLinkRow({
  link,
  title,
  pending,
  onRevoke,
}: {
  readonly link: PaymentLink;
  readonly title: string;
  readonly pending: boolean;
  readonly onRevoke: (link: PaymentLink) => void;
}) {
  const inputId = useId();
  const [copyMessage, setCopyMessage] = useState("");
  const href = paymentLinkHref(link.id);
  const url =
    typeof window === "undefined"
      ? href
      : new URL(href, window.location.origin).toString();
  return (
    <section className={styles["item"]}>
      <h3>
        {title} · {formatKopecks(link.snapshot.firstPriceKopecks)}
      </h3>
      <p>
        {paymentLinkStateLabels[link.state]}
        {link.expiresAt === null
          ? " · без даты окончания"
          : ` · до ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(link.expiresAt))} (Москва)`}
      </p>
      <label htmlFor={inputId}>Ссылка для покупателя</label>
      <input
        id={inputId}
        value={url}
        readOnly
        onFocus={(event) => {
          event.target.select();
        }}
      />
      <div className={styles["actions"]}>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => {
                setCopyMessage("Ссылка скопирована.");
              },
              () => {
                setCopyMessage("Скопируйте ссылку вручную из поля.");
              },
            );
          }}
        >
          Скопировать ссылку
        </Button>
        <Button variant="outline" asChild>
          <Link href={href} target="_blank" rel="noreferrer" prefetch={false}>
            Посмотреть оформление
          </Link>
        </Button>
        <Button
          variant="destructive"
          disabled={pending || link.state !== "active"}
          onClick={() => {
            onRevoke(link);
          }}
        >
          Отозвать ссылку
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Ссылка одноразовая. Создание и копирование не отправляют сообщения.
      </p>
      {(link.state === "pending" || link.state === "unknown") && (
        <p>
          Платёж ждёт результата банка. Ссылка зарезервирована; отзыв
          недоступен.
        </p>
      )}
      {link.state === "paid" && (
        <p>Отзыв ссылки не отменяет покупку и выданный доступ.</p>
      )}
      <p role="status">{copyMessage}</p>
    </section>
  );
}
