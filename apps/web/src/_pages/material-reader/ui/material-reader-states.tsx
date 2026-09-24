import {
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
  SearchX,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";

import type { MaterialReaderMetadata } from "@/_pages/material-reader/model/material-reader-view";
import type { SeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { Button } from "@/shared/ui/button";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import { StatusPanel } from "@/shared/ui/status-panel";
import {
  homeMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import type { PurchaseInvitation } from "@/shared/routing/subscription-route";
import {
  MaterialReaderHeader,
  MaterialReaderFooter,
} from "./material-reader-view";

import { ReaderReturnNavigation } from "./reader-return-navigation.client";

/**
 * Скелет маршрута: об уроке ещё ничего не известно. Он собран из рамки самого ридера — кнопка
 * возврата, колонка `43rem`, шапка и текст, — поэтому готовая страница встаёт на его место. Высота
 * не меньше экрана: подвал ждёт за его краем и не прыгает, когда приходит текст (#670).
 */
export function MaterialReaderLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Материал загружается"
      className="@container/material-reader min-h-svh"
      data-material-reader-state="loading"
      data-route-skeleton="material-reader"
    >
      <div className="mx-auto mb-6 max-w-[43rem]" data-reader-return="top">
        <div className="h-11 w-44 max-w-full rounded-full bg-muted" />
      </div>
      <div className="mx-auto min-w-0 max-w-[43rem]">
        <div className="animate-pulse motion-reduce:animate-none" data-reader-header>
          <div className="h-5 w-64 max-w-full rounded-md bg-muted" />
          <div className="mt-4 h-[1.75rem] w-4/5 rounded-lg bg-muted md:h-[2.125rem]" />
          <div className="mt-4 h-7 w-full rounded-md bg-muted/80" />
          <div className="h-7 w-3/4 rounded-md bg-muted/80" />
        </div>
        <ReaderBodySkeleton />
      </div>
      <p className="sr-only">Загружаем опубликованный материал</p>
    </div>
  );
}

/**
 * Общая часть урока уже известна, личная ещё идёт: шапка, возврат и соседи по продукту настоящие,
 * на месте тела — его скелет. Готовый урок рисует ту же рамку, поэтому шапка не двигается.
 */
export function MaterialReaderPending({
  material,
  returnTarget = homeMaterialReaderReturnTarget,
  seriesContext = null,
}: {
  readonly material: MaterialReaderMetadata;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly seriesContext?: SeriesReaderContext | null;
}) {
  return (
    <div
      className="@container/material-reader min-h-svh"
      data-material-id={material.materialId}
      data-material-reader-state="pending"
    >
      <ReaderReturnNavigation repeatAtBottom={false} target={returnTarget}>
        <div className="mx-auto min-w-0 max-w-[43rem]">
          <MaterialReaderHeader material={material} />
          <div aria-busy="true" aria-label="Текст материала загружается" data-route-skeleton="material-reader">
            <ReaderBodySkeleton />
          </div>
          <MaterialReaderFooter seriesContext={seriesContext} />
        </div>
      </ReaderReturnNavigation>
    </div>
  );
}

/** Строки на месте текста: интервал и отступ сверху повторяют `article` ридера. */
function ReaderBodySkeleton() {
  return (
    <div className="mt-10 grid animate-pulse gap-3 motion-reduce:animate-none" data-reader-body-skeleton>
      {["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-10/12", "w-full", "w-3/5", "w-full", "w-11/12", "w-full", "w-2/3"].map(
        (width, index) => (
          <div className={`h-[1.125rem] rounded-md bg-muted/80 md:h-5 ${width}`} key={index} />
        ),
      )}
    </div>
  );
}

export function MaterialReaderNotFound({
  returnTarget = homeMaterialReaderReturnTarget,
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
    title: "Продолжение входит в продукт",
    explanation: "Купите продукт — и весь его маршрут откроется целиком.",
  },
  subscription: {
    title: "Продолжение для участников",
    explanation: "Откройте полный материал и весь маршрут по теме.",
  },
  none: {
    title: "Продолжение для участников",
    explanation: "Купить доступ сейчас нельзя, но материал останется здесь.",
  },
} as const;

/** Действие есть только там, где есть что купить. */
const accessAction = {
  guide: "Купить продукт",
  subscription: "Получить доступ",
} as const;

/**
 * Закрытый материал: отказ объяснён словами и даёт ровно один следующий шаг внутри платформы —
 * оплату выбранного руководства или витрину подписки. Когда покупать нечего, обещания нет.
 */
export function MaterialReaderAccess({
  readingAction,
  invitation,
  material,
  returnTarget = homeMaterialReaderReturnTarget,
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
                      {accessAction[invitation.kind]}
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
  returnTarget = homeMaterialReaderReturnTarget,
}: {
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  return (
    <ReaderStatus
      action={
        <div className="flex flex-wrap gap-3">
          <RetryPageButton />
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
  returnTarget = homeMaterialReaderReturnTarget,
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
    <StatusPanel
      action={action}
      icon={icon}
      message={message}
      state={{ "data-material-reader-state": state }}
      title={title}
    />
  );
}
