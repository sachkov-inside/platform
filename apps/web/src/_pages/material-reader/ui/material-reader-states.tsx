import {
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
  SearchX,
  ShieldAlert,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { MaterialReaderMetadata } from "@/_pages/material-reader/model/material-reader-view";
import type { SeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { Button } from "@/shared/ui/button";
import {
  libraryMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import type { PurchaseInvitation } from "@/shared/routing/subscription-route";
import {
  MaterialReaderHeader,
  MaterialReaderFooter,
} from "./material-reader-view";

import { ReaderReturnNavigation } from "./reader-return-navigation.client";

export function MaterialReaderLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Материал загружается"
      className="max-w-[48rem] pt-1 sm:pt-3"
      data-material-reader-state="loading"
    >
      <div className="animate-pulse rounded-2xl bg-secondary px-6 py-7 shadow-card motion-reduce:animate-none sm:px-8 sm:py-9">
        <div className="size-12 rounded-xl bg-muted" />
        <div className="mt-6 h-9 w-full max-w-lg rounded-xl bg-muted sm:h-11" />
        <div className="mt-4 h-5 w-full max-w-xl rounded-lg bg-muted/80" />
        <div className="mt-2 h-5 w-4/5 max-w-lg rounded-lg bg-muted/80" />
        <div className="mt-7 flex gap-3">
          <div className="h-11 w-32 rounded-xl bg-muted" />
          <div className="h-11 w-40 rounded-xl bg-muted/80" />
        </div>
      </div>
      <p className="sr-only">Загружаем опубликованный материал</p>
    </div>
  );
}

export function MaterialReaderNotFound({
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  return (
    <ReaderStatus
      action={
        <Button asChild size="lg">
          <Link href={returnTarget.href}>
            <ArrowLeft aria-hidden="true" />
            {returnTarget.label}
          </Link>
        </Button>
      }
      icon={<SearchX aria-hidden="true" />}
      message="Проверьте адрес или выберите другой материал в Базе знаний."
      state="not-found"
      title="Материал не найден"
    />
  );
}

/**
 * Слова отказа собраны рядом: заголовок, объяснение и действие меняются вместе, потому что они
 * рассказывают одну историю. Разложенные по трём условиям, они разъезжаются при первой правке.
 */
const accessCopy = {
  guide: {
    title: "Продолжение входит в руководство",
    explanation: "Купите руководство — и весь его маршрут откроется целиком.",
    action: "Купить руководство",
  },
  subscription: {
    title: "Продолжение для участников",
    explanation: "Откройте полный материал и весь маршрут по теме.",
    action: "Получить доступ",
  },
  none: {
    title: "Продолжение для участников",
    explanation: "Купить доступ сейчас нельзя, но материал останется здесь.",
    action: "",
  },
} as const;

/**
 * Закрытый материал: отказ объяснён словами и даёт ровно один следующий шаг внутри платформы —
 * оплату выбранного руководства или витрину подписки. Когда покупать нечего, обещания нет.
 */
export function MaterialReaderAccess({
  readingAction,
  invitation,
  material,
  returnTarget = libraryMaterialReaderReturnTarget,
  seriesContext = null,
}: {
  readonly readingAction?: React.ReactNode;
  readonly invitation: PurchaseInvitation | null;
  readonly material: MaterialReaderMetadata;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly seriesContext?: SeriesReaderContext | null;
}) {
  const copy = accessCopy[invitation?.kind ?? "none"];
  return (
    <div data-material-reader-state="access-required">
      <ReaderReturnNavigation repeatAtBottom={seriesContext === null} target={returnTarget}>
        <div className="mx-auto max-w-[43rem]">
          <MaterialReaderHeader material={material} />
          <section
            className="relative mt-10 overflow-hidden rounded-[2rem] border border-black/6 bg-muted p-6 md:mt-12 md:p-9"
            aria-labelledby="access-heading"
          >
            <div
              aria-hidden="true"
              className="select-none space-y-5 blur-[7px] opacity-45"
            >
              <div className="h-7 w-2/3 rounded-full bg-placeholder-strong" />
              <div className="space-y-3">
                <div className="h-4 rounded-full bg-placeholder" />
                <div className="h-4 w-11/12 rounded-full bg-placeholder" />
                <div className="h-4 w-4/5 rounded-full bg-placeholder" />
              </div>
              <div className="h-36 rounded-[1.5rem] bg-white" />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-white/20 via-white/70 to-white/95 px-6 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-white text-accent shadow-lg">
                <LockKeyhole aria-hidden="true" className="size-5" />
              </span>
              <h2
                className="mt-4 text-balance text-2xl font-semibold tracking-[-0.04em]"
                id="access-heading"
              >
                {copy.title}
              </h2>
              <p className="mt-2 max-w-sm text-pretty text-sm leading-6 text-muted-foreground">
                {copy.explanation}
              </p>
              {invitation === null ? null : (
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Button
                    asChild
                    className="h-auto min-h-11 max-w-full whitespace-normal rounded-xl bg-accent px-4 text-white hover:bg-accent-hover"
                    size="lg"
                  >
                    <Link href={invitation.href}>
                      {copy.action}
                      <ArrowRight
                        aria-hidden="true"
                        className="shrink-0 text-sidebar-primary transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] group-hover/button:translate-x-0.5 motion-reduce:transition-none"
                        data-icon="inline-end"
                      />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </section>
          {readingAction}
          <MaterialReaderFooter seriesContext={seriesContext} />
        </div>
      </ReaderReturnNavigation>
    </div>
  );
}

export function MaterialReaderUnavailable({
  retryHref,
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly retryHref: Route;
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  return (
    <ReaderStatus
      action={
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={retryHref}>Повторить</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={returnTarget.href}>{returnTarget.label}</Link>
          </Button>
        </div>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Сервис чтения не отвечает. Попробуйте ещё раз через несколько минут."
      state="unavailable"
      title="Материал временно недоступен"
    />
  );
}

export function MaterialReaderUnexpectedError({
  onRetry,
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly onRetry: () => void;
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  return (
    <ReaderStatus
      action={
        <div className="flex flex-wrap gap-3">
          <Button onClick={onRetry} size="lg">
            Повторить
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={returnTarget.href}>{returnTarget.label}</Link>
          </Button>
        </div>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Не удалось загрузить материал. Попробуйте ещё раз."
      state="unexpected-error"
      title="Материал сейчас недоступен"
    />
  );
}

function ReaderStatus({
  action,
  icon,
  message,
  state,
  title,
}: {
  readonly action: React.ReactNode;
  readonly icon: React.ReactNode;
  readonly message: string;
  readonly state: string;
  readonly title: string;
}) {
  return (
    <section
      className="max-w-[48rem] pt-1 sm:pt-3"
      data-material-reader-state={state}
    >
      <div className="relative isolate overflow-clip rounded-2xl bg-secondary px-6 py-7 shadow-card sm:px-8 sm:py-9">
        <StatusHalo />
        <span className="relative grid size-12 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-6">
          {icon}
        </span>
        <h1 className="relative mt-5 max-w-[18ch] text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
          {title}
        </h1>
        <p className="relative mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">
          {message}
        </p>
        <div className="relative mt-7">{action}</div>
      </div>
    </section>
  );
}

function StatusHalo() {
  return (
    <span
      aria-hidden="true"
      className="reader-status-halo absolute -right-10 -top-16 size-48 rounded-full bg-accent/15"
    />
  );
}
