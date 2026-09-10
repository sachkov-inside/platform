"use client";
import { useId, useState } from "react";

import { Button } from "@/shared/ui/button";

import {
  legalDocumentLabel,
  type LegalDocument,
} from "@/entities/subscription";

import type { BillingContact } from "../model/billing-contact";

export interface BillingContactFormProps {
  readonly contact: BillingContact | null;
  /** Применимые документы приходят с сервера; до их публикации список пуст. */
  readonly documents?: readonly LegalDocument[];
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly unavailable?: boolean;
  readonly sessionExpired?: boolean;
  readonly verified?: boolean;
  readonly editing?: boolean;
  readonly challenge: {
    readonly email: string;
    readonly delivery: "sent" | "unknown";
  } | null;
  readonly headingLevel?: "h1" | "h2";
  readonly onEdit?: () => void;
  readonly onCancelEdit?: () => void;
  readonly onStart: (email: string) => void;
  readonly onConfirm: (code: string) => void;
  readonly onRefresh: () => void;
}

const fieldClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-4 text-base shadow-sm transition-colors placeholder:text-muted-foreground/65 focus:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Подтверждённый контакт для чеков и служебных сообщений. Прежний адрес действует до
 * подтверждения нового, поэтому смена — отдельный явный шаг, а не правка поля.
 */
export function BillingContactForm({
  contact,
  documents = [],
  loading,
  pending,
  error,
  verified,
  unavailable,
  sessionExpired,
  editing,
  challenge,
  headingLevel = "h2",
  onEdit,
  onCancelEdit,
  onStart,
  onConfirm,
  onRefresh,
}: BillingContactFormProps) {
  const Heading = headingLevel;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const emailId = useId();
  const codeId = useId();
  const codeHelpId = useId();
  const editorOpen = contact === null || editing === true;
  return (
    <section
      aria-labelledby={`${emailId}-heading`}
      className="min-w-0 rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <Heading
        className="text-2xl font-bold tracking-[-0.035em]"
        id={`${emailId}-heading`}
      >
        Email для чеков и сообщений
      </Heading>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Чек и служебные сообщения о подписке приходят на подтверждённый адрес.
        Это не способ входа.
      </p>

      {sessionExpired ? (
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm" role="alert">
          <p className="font-semibold">Сессия завершилась.</p>
          <form action="/auth/sign-in" className="mt-3" method="post">
            <input name="returnTo" type="hidden" value="/account/email" />
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" type="submit">
              Войти снова
            </Button>
          </form>
        </div>
      ) : loading === true ? (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          Загружаем email…
        </p>
      ) : unavailable === true ? (
        <div className="mt-5 space-y-3 text-sm" role="alert">
          <p>{error ?? "Данные контакта сейчас недоступны."}</p>
          <Button
            className="h-auto min-h-11 max-w-full whitespace-normal"
            disabled={pending}
            onClick={onRefresh}
            type="button"
            variant="outline"
          >
            Обновить данные
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-5 break-words text-sm leading-6">
            {contact === null ? (
              "Email пока не подтверждён."
            ) : (
              <>
                Подтверждённый адрес:{" "}
                <strong className="font-semibold">{contact.email}</strong>.
                {editorOpen
                  ? " Он продолжит действовать, пока не подтверждён новый."
                  : null}
              </>
            )}
          </p>

          {contact !== null && !editorOpen ? (
            <Button
              className="mt-4 h-auto min-h-11 max-w-full whitespace-normal"
              disabled={pending}
              onClick={onEdit}
              type="button"
              variant="outline"
            >
              Изменить адрес
            </Button>
          ) : null}

          {editorOpen ? (
            <form
              className="mt-5"
              onSubmit={(event) => {
                event.preventDefault();
                setCode("");
                onStart(email.trim());
              }}
            >
              <label className="text-sm font-semibold" htmlFor={emailId}>
                {contact === null ? "Email" : "Новый email"}
              </label>
              <input
                autoComplete="email"
                className={fieldClassName}
                disabled={pending}
                id={emailId}
                maxLength={254}
                name="email"
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                }}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
                  {pending === true
                    ? "Подождите…"
                    : challenge === null
                      ? "Получить код"
                      : "Отправить новый код"}
                </Button>
                {contact !== null && onCancelEdit !== undefined ? (
                  <Button
                    className="h-auto min-h-11 max-w-full whitespace-normal"
                    disabled={pending}
                    onClick={onCancelEdit}
                    type="button"
                    variant="ghost"
                  >
                    Оставить прежний
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}

          {challenge === null ? null : (
            <form
              className="mt-5 border-t border-border pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                onConfirm(code);
              }}
            >
              <p className="break-words text-sm leading-6" role="status">
                {challenge.delivery === "sent"
                  ? "Код отправлен на"
                  : "Отправка пока не подтверждена. Если письмо пришло, введите код для"}{" "}
                <strong className="font-semibold">{challenge.email}</strong>.
              </p>
              <label className="mt-4 block text-sm font-semibold" htmlFor={codeId}>
                Код из письма
              </label>
              <input
                aria-describedby={codeHelpId}
                autoComplete="one-time-code"
                className={`${fieldClassName} font-mono tracking-[0.35em]`}
                disabled={pending}
                id={codeId}
                inputMode="numeric"
                maxLength={6}
                name="code"
                onChange={(event) => {
                  setCode(event.currentTarget.value);
                }}
                pattern="[0-9]{6}"
                required
                type="text"
                value={code}
              />
              <p className="mt-2 text-xs text-muted-foreground" id={codeHelpId}>
                Шесть цифр из последнего письма. Код действует 10 минут, новый
                можно запросить через минуту.
              </p>
              <Button className="mt-4 h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
                Подтвердить email
              </Button>
            </form>
          )}

          {verified === true ? (
            <p className="mt-5 text-sm font-semibold" role="status">
              Email подтверждён.
            </p>
          ) : null}

          {error !== undefined ? (
            <div className="mt-5 space-y-3 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm" role="alert">
              <p>{error}</p>
              <Button
                className="h-auto min-h-11 max-w-full whitespace-normal"
                disabled={pending}
                onClick={onRefresh}
                type="button"
                variant="outline"
              >
                Обновить данные
              </Button>
            </div>
          ) : null}
        </>
      )}

      {documents.length === 0 ? null : (
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-sm">
          {documents.map((document) => (
            <li key={`${document.kind}:${document.documentId}`}>
              <a
                className="text-action underline underline-offset-4"
                href={document.url}
                rel="noreferrer"
                target="_blank"
              >
                {legalDocumentLabel(document.kind)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
