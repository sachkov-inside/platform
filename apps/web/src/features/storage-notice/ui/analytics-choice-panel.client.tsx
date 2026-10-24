"use client";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/shared/ui/button";

/** Temporary semantic UI for #1566. Visual acceptance remains on #1566 before activation. */
export function AnalyticsChoicePanel({
  policyHref,
  onChoose,
  error = false,
  focusOnOpen = false,
}: {
  readonly policyHref: Route;
  readonly onChoose: (choice: "necessary" | "allowed") => void;
  readonly error?: boolean;
  readonly focusOnOpen?: boolean;
}) {
  const notice = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = notice.current;
    if (element === null) return;
    if (focusOnOpen) element.focus();
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--storage-notice-space",
        `${String(element.offsetHeight)}px`,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--storage-notice-space");
    };
  }, [focusOnOpen]);
  return (
    <section
      ref={notice}
      tabIndex={-1}
      aria-label="Cookies и аналитика"
      className="storage-notice fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
    >
      <h2 className="text-base font-semibold">Cookies и аналитика</h2>
      <p className="mt-2 text-sm leading-6">
        Необходимые технологии сохраняют вход и прогресс. С вашего разрешения мы
        также собираем статистику посещений и действий на сайте. Отказ не
        ограничит материалы и покупки.
      </p>
      <Link
        href={policyHref}
        className="mt-1 inline-flex min-h-11 items-center text-sm text-action underline underline-offset-4"
      >
        Подробнее о хранении данных
      </Link>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          variant="outline"
          className="min-h-11 px-4"
          onClick={() => {
            onChoose("necessary");
          }}
        >
          Только необходимые
        </Button>
        <Button
          variant="outline"
          className="min-h-11 px-4"
          onClick={() => {
            onChoose("allowed");
          }}
        >
          Разрешить
        </Button>
      </div>
      {error ? (
        <p role="status" className="mt-3 text-sm leading-6">
          Не удалось сохранить выбор. Аналитика выключена. Разрешите локальное
          хранение в настройках браузера и повторите попытку.
        </p>
      ) : null}
    </section>
  );
}
