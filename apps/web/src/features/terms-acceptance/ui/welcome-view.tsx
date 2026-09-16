import type { Route } from "next";
import Link from "next/link";

import { Button } from "@/shared/ui/button";

import { termsAcceptanceButtonLabel } from "../model/terms-acceptance";

export interface WelcomeViewProps {
  /** Человек уже принимал прежнюю редакцию: экран говорит, что условия обновились. */
  readonly returning: boolean;
  /** Постоянный адрес принимаемой редакции условий. */
  readonly termsHref: Route;
  readonly privacyHref: Route;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  /** Проверить условия сейчас нельзя: кнопки нет, человек видит причину. */
  readonly unavailable?: boolean;
  readonly onAccept?: () => void;
}

/**
 * Экран первого входа (путь A): условия принимаются одной кнопкой со строкой о принятии рядом.
 * Отметок нет; кабинет, покупки и связка с ботом открываются после нажатия.
 */
export function WelcomeView({
  returning,
  termsHref,
  privacyHref,
  pending = false,
  error,
  unavailable = false,
  onAccept,
}: WelcomeViewProps) {
  return (
    <div className="mx-auto w-full max-w-xl py-6 sm:py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {returning ? "Условия обновились" : "Аккаунт создан"}
      </p>
      <h1 className="mt-3 text-4xl font-bold tracking-[-0.045em] sm:text-5xl">
        Добро пожаловать в Inside
      </h1>
      <p className="mt-3 text-base leading-7 text-muted-foreground">
        {returning
          ? "Мы обновили условия использования. Осталось принять действующую редакцию."
          : "Вы вошли в Inside. Осталось одно действие."}
      </p>

      <section
        aria-label="Условия использования"
        className="mt-7 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7"
      >
        {unavailable ? (
          <p className="text-sm leading-6" role="alert">
            Условия сейчас не удаётся загрузить. Обновите страницу немного позже.
          </p>
        ) : (
          <>
            <Button
              className="min-h-12 w-full text-base"
              disabled={pending}
              onClick={onAccept}
              size="lg"
              type="button"
            >
              {pending ? "Принимаем…" : termsAcceptanceButtonLabel}
            </Button>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Нажимая кнопку, вы принимаете{" "}
              <Link className="text-action underline underline-offset-4" href={termsHref}>
                условия использования
              </Link>
              ; пользоваться Inside можно с 14 лет. Данные аккаунта обрабатываются по{" "}
              <Link className="text-action underline underline-offset-4" href={privacyHref}>
                политике персональных данных
              </Link>
              .
            </p>
          </>
        )}
        {error === undefined ? null : (
          <p
            className="mt-4 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
            role="alert"
          >
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
