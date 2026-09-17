import type { Route } from "next";
import Link from "next/link";

import { Button } from "@/shared/ui/button";

import { termsAcceptanceButtonLabel } from "../model/terms-acceptance";
import { WelcomeDialog } from "./welcome-dialog.client";

export interface WelcomeViewProps {
  /** Человек уже принимал прежнюю редакцию: окно говорит, что условия обновились. */
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

const titleId = "welcome-dialog-title";

/**
 * Окно первого входа (путь A): поверх сайта одна кнопка принятия и строка о том, что она значит.
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
    <WelcomeDialog dismissible={unavailable} labelledBy={titleId}>
      <div className="p-6 sm:p-7">
        <p className="text-[0.95rem] font-semibold tracking-[-0.02em]">
          Sachkov <span className="text-action">Inside</span>
        </p>
        <h1 className="mt-5 text-[1.75rem] font-bold leading-[1.1] tracking-[-0.04em]" id={titleId}>
          {returning ? "Условия обновились" : "Добро пожаловать"}
        </h1>
        {unavailable ? (
          <>
            <p className="mt-4 text-sm leading-6" role="alert">
              Условия сейчас не удаётся загрузить. Обновите страницу немного позже.
            </p>
            <Button asChild className="mt-6 min-h-12 w-full text-base" data-dialog-initial-focus size="lg" variant="outline">
              <Link href="/">На главную</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
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
            <Button
              className="mt-6 min-h-12 w-full text-base"
              data-dialog-initial-focus
              disabled={pending}
              onClick={onAccept}
              size="lg"
              type="button"
            >
              {pending ? "Принимаем…" : termsAcceptanceButtonLabel}
            </Button>
          </>
        )}
        {error === undefined ? null : (
          <p
            className="mt-4 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm leading-6"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </WelcomeDialog>
  );
}
