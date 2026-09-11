"use client";
import Link from "next/link";
import type { Route } from "next";
import { useId } from "react";

import { Button } from "@/shared/ui/button";

export type NotificationChannel = "email" | "telegram";

export interface NotificationChannelsFormProps {
  readonly email: boolean;
  readonly telegram: boolean;
  readonly dirty: boolean;
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly saved?: boolean;
  readonly unavailable?: boolean;
  readonly sessionExpired?: boolean;
  readonly error?: string | undefined;
  readonly accountHref: Route;
  readonly onChange: (channel: NotificationChannel, value: boolean) => void;
  readonly onSave: () => void;
  readonly onRefresh: () => void;
}

/**
 * Каналы сообщений о новых материалах. Служебные сообщения об оплате приходят на
 * подтверждённый email независимо от этого выбора — это разные поводы.
 */
export function NotificationChannelsForm({
  email,
  telegram,
  dirty,
  loading = false,
  pending = false,
  saved = false,
  unavailable = false,
  sessionExpired = false,
  error,
  accountHref,
  onChange,
  onSave,
  onRefresh,
}: NotificationChannelsFormProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <h2 className="text-xl font-semibold" id={headingId}>
        Новые материалы
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Сообщение приходит один раз — когда материал опубликован впервые. Чеки и
        служебные сообщения об оплате приходят на подтверждённый email всегда.
      </p>

      {sessionExpired ? (
        <div
          className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm"
          role="alert"
        >
          <p className="font-semibold">Сессия завершилась.</p>
          <form action="/auth/sign-in" className="mt-3" method="post">
            <input name="returnTo" type="hidden" value="/account/notifications" />
            <Button className="min-h-11 px-4" type="submit">
              Войти снова
            </Button>
          </form>
        </div>
      ) : loading ? (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          Загружаем настройки…
        </p>
      ) : unavailable ? (
        <div className="mt-5 space-y-3 text-sm" role="alert">
          <p>{error ?? "Настройки уведомлений сейчас недоступны."}</p>
          <Button
            className="min-h-11 px-4"
            disabled={pending}
            onClick={onRefresh}
            type="button"
            variant="outline"
          >
            Обновить данные
          </Button>
        </div>
      ) : (
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <fieldset>
            <legend className="sr-only">Каналы уведомлений</legend>
            <ul className="grid gap-3">
              <li>
                <ChannelToggle
                  channel="email"
                  checked={email}
                  disabled={pending}
                  hint="Письмом на подтверждённый адрес."
                  label="Email"
                  onChange={onChange}
                />
              </li>
              <li>
                <ChannelToggle
                  channel="telegram"
                  checked={telegram}
                  disabled={pending}
                  hint="Сообщением от бота. Работает, когда аккаунт связан с Telegram."
                  label="Telegram"
                  onChange={onChange}
                />
              </li>
            </ul>
          </fieldset>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button className="min-h-11 px-4" disabled={pending || !dirty} type="submit">
              {pending ? "Сохраняем…" : "Сохранить"}
            </Button>
            {saved && !dirty ? (
              <span className="text-sm font-semibold" role="status">
                Выбор сохранён.
              </span>
            ) : null}
          </div>

          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Связь с Telegram настраивается в разделе{" "}
            <Link
              className="text-action underline underline-offset-4"
              href={accountHref}
            >
              «Аккаунт»
            </Link>
            .
          </p>

          {error === undefined ? null : (
            <p
              className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
              role="alert"
            >
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function ChannelToggle({
  channel,
  checked,
  disabled,
  hint,
  label,
  onChange,
}: {
  readonly channel: NotificationChannel;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly hint: string;
  readonly label: string;
  readonly onChange: (channel: NotificationChannel, value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm leading-6">
      <input
        checked={checked}
        className="mt-1 size-5 shrink-0 accent-primary"
        disabled={disabled}
        name={`notification-channel-${channel}`}
        onChange={(event) => {
          onChange(channel, event.currentTarget.checked);
        }}
        type="checkbox"
      />
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        <span className="block text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
