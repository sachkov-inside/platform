"use client";

import { useId, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/shared/ui/button";

export interface AccountEmailFormProps {
  readonly email: string | null;
  readonly loading?: boolean;
  readonly unavailable?: boolean;
  readonly pending?: boolean;
  readonly verified?: boolean;
  readonly error?: string | undefined;
  readonly sessionExpired?: boolean;
  readonly challenge: {
    readonly email: string;
    readonly challengeRef: string;
  } | null;
  readonly onStart: (email: string) => void;
  readonly onConfirm: (code: string) => void;
  readonly onRetry: () => void;
  readonly onChangeAddress: () => void;
}

export function AccountEmailForm({
  email,
  loading = false,
  unavailable = false,
  pending = false,
  verified = false,
  error,
  sessionExpired = false,
  challenge,
  onStart,
  onConfirm,
  onRetry,
  onChangeAddress,
}: AccountEmailFormProps) {
  const id = useId();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby={`${id}-heading`}>
      <h3
        className="flex items-center gap-2 text-base font-semibold"
        id={`${id}-heading`}
      >
        <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
        Почта
      </h3>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Загружаем почту…
        </p>
      ) : sessionExpired ? (
        <div className="mt-3 text-sm" role="alert">
          <p>Войдите снова, чтобы управлять почтой.</p>
          <form action="/auth/sign-in" method="post">
            <input name="returnTo" type="hidden" value="/account" />
            <Button className="mt-3 min-h-11" type="submit" variant="outline">
              Войти снова
            </Button>
          </form>
        </div>
      ) : unavailable ? (
        <div className="mt-3 text-sm" role="alert">
          <p>Не удалось загрузить почту.</p>
          <Button
            className="mt-3 min-h-11"
            onClick={onRetry}
            type="button"
            variant="outline"
          >
            Попробовать снова
          </Button>
        </div>
      ) : email !== null ? (
        <div className="mt-3">
          <p className="break-all text-sm">{email}</p>
          {verified ? (
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              Почта подтверждена и привязана.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-col items-start justify-between gap-4 sm:flex-row">
            <p className="max-w-lg text-sm leading-6 text-muted-foreground">
              Добавьте почту, чтобы входить в этот же аккаунт по коду из письма.
            </p>
            {!editing && challenge === null ? (
              <Button
                className="min-h-11 shrink-0"
                onClick={() => {
                  setEditing(true);
                }}
                type="button"
                variant="outline"
              >
                Добавить почту
              </Button>
            ) : null}
          </div>
          {!editing && challenge === null ? null : challenge === null ? (
            <form
              className="mt-4 max-w-xl"
              onSubmit={(event) => {
                event.preventDefault();
                onStart(address.trim());
              }}
            >
              <label className="text-sm font-medium" htmlFor={`${id}-email`}>
                Адрес почты
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  autoComplete="email"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3"
                  disabled={pending}
                  id={`${id}-email`}
                  maxLength={128}
                  name="email"
                  onChange={(event) => {
                    setAddress(event.currentTarget.value);
                  }}
                  required
                  type="email"
                  value={address}
                />
                <Button className="min-h-11" disabled={pending} type="submit">
                  {pending ? "Отправляем…" : "Получить код"}
                </Button>
              </div>
            </form>
          ) : (
            <form
              className="mt-4 max-w-xl"
              onSubmit={(event) => {
                event.preventDefault();
                onConfirm(code);
              }}
            >
              <p className="break-words text-sm" role="status">
                Код отправлен на {challenge.email}.
              </p>
              <label
                className="mt-4 block text-sm font-medium"
                htmlFor={`${id}-code`}
              >
                Код из письма
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  aria-describedby={`${id}-code-help`}
                  autoComplete="one-time-code"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 font-mono tracking-widest"
                  disabled={pending}
                  id={`${id}-code`}
                  inputMode="numeric"
                  maxLength={6}
                  name="code"
                  onChange={(event) => {
                    setCode(event.currentTarget.value);
                  }}
                  pattern="[0-9]{6}"
                  required
                  value={code}
                />
                <Button className="min-h-11" disabled={pending} type="submit">
                  {pending ? "Проверяем…" : "Подтвердить почту"}
                </Button>
              </div>
              <p
                className="mt-2 text-xs text-muted-foreground"
                id={`${id}-code-help`}
              >
                Шесть цифр из письма. Код действует 10 минут.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  disabled={pending}
                  onClick={() => {
                    setCode("");
                    onStart(challenge.email);
                  }}
                  type="button"
                  variant="outline"
                >
                  Отправить код повторно
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => {
                    setCode("");
                    onChangeAddress();
                  }}
                  type="button"
                  variant="ghost"
                >
                  Изменить адрес
                </Button>
              </div>
            </form>
          )}
          {error === undefined ? null : (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
