"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import type { BillingContact } from "../model/billing-contact";

/**
 * Temporary semantic UI for #406.
 * Replace through #411 after Storybook acceptance.
 */
export interface BillingContactFormProps {
  readonly contact: BillingContact | null;
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly unavailable?: boolean;
  readonly verified?: boolean;
  readonly challenge: {
    readonly email: string;
    readonly delivery: "sent" | "unknown";
  } | null;
  readonly onStart: (email: string) => void;
  readonly onConfirm: (code: string) => void;
  readonly onRefresh: () => void;
}
export function BillingContactForm({
  contact,
  loading,
  pending,
  error,
  verified,
  unavailable,
  challenge,
  onStart,
  onConfirm,
  onRefresh,
}: BillingContactFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  return (
    <section
      className="mx-auto max-w-xl space-y-6"
      aria-labelledby="billing-contact-heading"
    >
      <Link className="text-sm underline underline-offset-4" href="/account">
        В аккаунт
      </Link>
      <h1 className="text-3xl font-bold" id="billing-contact-heading">
        Email для чеков и уведомлений
      </h1>
      <p className="text-muted-foreground">
        Подтвердите адрес, на который вы хотите получать чеки и сообщения о
        подписке.
      </p>
      {loading ? (
        <p role="status">Загружаем email…</p>
      ) : unavailable ? null : (
        <>
          {contact ? (
            <p className="break-words">
              Подтверждённый адрес: <strong>{contact.email}</strong>. Он
              продолжит действовать до подтверждения нового.
            </p>
          ) : (
            <p>Email пока не подтверждён.</p>
          )}
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setCode("");
              onStart(email.trim());
            }}
          >
            <label className="block font-medium" htmlFor="billing-email">
              {contact ? "Новый email" : "Email"}
            </label>
            <input
              className="min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring"
              id="billing-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => {
                setEmail(event.currentTarget.value);
              }}
              disabled={pending}
            />
            <Button className="min-h-11" type="submit" disabled={pending}>
              {pending
                ? "Подождите…"
                : challenge
                  ? "Отправить новый код"
                  : "Получить код"}
            </Button>
          </form>
          {challenge ? (
            <form
              className="space-y-3 border-t border-border pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                onConfirm(code);
              }}
            >
              <p className="break-words" role="status">
                {challenge.delivery === "sent"
                  ? "Код отправлен на"
                  : "Отправка пока не подтверждена. Если письмо пришло, введите код для"}{" "}
                <strong>{challenge.email}</strong>.
              </p>
              <p
                className="text-sm text-muted-foreground"
                id="billing-code-help"
              >
                Введите 6 цифр из последнего письма. Код действует 10 минут.
                Новый код можно запросить через минуту.
              </p>
              <label className="block font-medium" htmlFor="billing-email-code">
                Код из письма
              </label>
              <input
                className="min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring"
                id="billing-email-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                aria-describedby="billing-code-help"
                value={code}
                onChange={(event) => {
                  setCode(event.currentTarget.value);
                }}
                disabled={pending}
              />
              <Button className="min-h-11" type="submit" disabled={pending}>
                Подтвердить email
              </Button>
            </form>
          ) : null}
        </>
      )}
      {verified ? <p role="status">Email подтверждён.</p> : null}
      {error ? (
        <div role="alert" className="space-y-3">
          <p>{error}</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={onRefresh}
            disabled={pending}
          >
            Обновить данные
          </Button>
        </div>
      ) : null}
    </section>
  );
}
