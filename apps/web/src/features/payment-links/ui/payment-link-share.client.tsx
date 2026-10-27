"use client";

import { Copy, ExternalLink, Share2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { paymentLinkHref, type PaymentLink } from "@/entities/subscription";
import { formatRubles } from "@/shared/lib/moscow-format";
import { Button } from "@/shared/ui/button";

import { paymentLinkExpiryLabel } from "../model/payment-link-expiry";
import { paymentLinkTitle } from "../model/payment-links-presentation";

/** Полный адрес ссылки для покупателя на адресе этой площадки. */
export function paymentLinkUrl(id: string): string {
  return new URL(paymentLinkHref(id), window.location.origin).toString();
}

/**
 * Копирует ссылку в буфер обмена. Без доступа к буферу просит скопировать вручную из поля:
 * ссылка уже видна и выделяется одним касанием.
 */
export async function copyPaymentLink(url: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(url);
    return "Ссылка скопирована.";
  } catch {
    return "Не удалось скопировать автоматически. Выделите ссылку в поле и скопируйте её.";
  }
}

/**
 * Созданная ссылка: адрес для покупателя, «Скопировать», «Поделиться» (меню отправки
 * устройства, где оно есть) и «Открыть оформление». Ни одно действие не отправляет сообщений
 * само: ссылку отправляет владелец.
 */
export function PaymentLinkShare({
  link,
  onDone,
}: {
  readonly link: PaymentLink;
  readonly onDone: () => void;
}) {
  const id = useId();
  // Компонент появляется только после создания ссылки, в браузере: адрес и меню отправки
  // читаются один раз при монтировании.
  const [url] = useState(() => paymentLinkUrl(link.id));
  const [canShare] = useState(
    () =>
      typeof navigator.share === "function" &&
      (typeof navigator.canShare !== "function" || navigator.canShare({ url })),
  );
  const [message, setMessage] = useState("");
  const title = paymentLinkTitle(link);

  return (
    <div className="grid gap-5" data-payment-link-created>
      <dl className="grid gap-1 text-sm">
        <dt className="sr-only">Продукт</dt>
        <dd className="font-semibold">{title}</dd>
        <dt className="sr-only">Цена</dt>
        <dd className="text-2xl font-semibold tabular-nums">
          {formatRubles(link.snapshot.firstPriceKopecks)}
        </dd>
        <dt className="sr-only">Срок</dt>
        <dd className="text-muted-foreground">
          {paymentLinkExpiryLabel(link.expiresAt)}
        </dd>
      </dl>
      <div className="admin-field">
        <label className="admin-field-label" htmlFor={id}>
          Ссылка для покупателя
        </label>
        <input
          className="admin-field-input max-w-none font-mono text-xs"
          id={id}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          readOnly
          value={url}
        />
        <p className="admin-field-hint">
          Отправьте её покупателю сами: создание и копирование ничего не
          отправляют.
        </p>
      </div>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Button
          className="min-h-11 px-4"
          onClick={() => {
            void copyPaymentLink(url).then(setMessage);
          }}
          type="button"
        >
          <Copy aria-hidden="true" data-icon="inline-start" />
          Скопировать ссылку
        </Button>
        {canShare ? (
          <Button
            className="min-h-11 px-4"
            onClick={() => {
              navigator.share({ title, url }).then(
                () => {
                  setMessage("Ссылка передана.");
                },
                (error: unknown) => {
                  // Закрытое без выбора меню отправки не ошибка.
                  if (
                    error instanceof DOMException &&
                    error.name === "AbortError"
                  )
                    return;
                  void copyPaymentLink(url).then(setMessage);
                },
              );
            }}
            type="button"
            variant="outline"
          >
            <Share2 aria-hidden="true" data-icon="inline-start" />
            Поделиться
          </Button>
        ) : null}
        <Button asChild className="min-h-11 px-4" variant="outline">
          <Link
            href={paymentLinkHref(link.id)}
            prefetch={false}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" data-icon="inline-start" />
            Открыть оформление
          </Link>
        </Button>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm" role="status">
        {message}
      </p>
      <div className="admin-dialog-footer">
        <Button
          className="min-h-11 px-4"
          onClick={onDone}
          type="button"
          variant="outline"
        >
          Готово
        </Button>
      </div>
    </div>
  );
}
