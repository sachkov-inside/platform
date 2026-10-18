import type { Route } from "next";
import type { ReactNode } from "react";

import { CourseMark } from "@/features/ai-engineering-course";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import { ProgrammeProgress } from "./series-learning.client";
import "./product-programme-view.css";

/** Shared course frame; route adapters own purchase and content decisions. */
export function ProductProgrammeFrame({
  children,
  courseMark = false,
  meta,
  name,
  productHref,
  purchase = null,
  slug,
  startBadge = null,
}: {
  readonly children: ReactNode;
  readonly courseMark?: boolean;
  readonly meta: string;
  readonly name: string;
  readonly productHref: Route;
  readonly purchase?: ReactNode;
  readonly slug: string;
  readonly startBadge?: ReactNode;
}) {
  return (
    <div
      className="programme-frame @container/programme mx-auto min-w-0 w-full max-w-[46rem]"
      data-product-programme={slug}
    >
      {/* Выход из прохождения — вверху слева, на Главную: снизу у программы свои разделы,
          и случайно уйти на Главную нельзя. Страница продукта — справа, для тех, кто его изучает. */}
      <nav
        aria-label="Путь навигации"
        className="-mt-3 flex flex-wrap items-center justify-between gap-x-3 sm:mt-0 sm:pt-4"
        data-programme-part="back"
      >
        <CatalogBackLink href="/" label="Главная" />
        <IntentPrefetchLink
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline decoration-border underline-offset-4"
          href={productHref}
        >
          О продукте
        </IntentPrefetchLink>
      </nav>

      <header
        className="relative mt-2 rounded-2xl bg-muted/60 p-4 sm:p-5"
        data-programme-part="header"
      >
        {startBadge}
        {/* Название и кнопка оплаты стоят в одном ряду; на узком экране кнопка уходит под
            название. Обложки в шапке программы нет (решение владельца 09.10.2026): это рабочий
            экран курса, картинка в маленьком размере ничего не сообщает. */}
        <div className="grid grid-cols-1 items-center gap-x-4 gap-y-4 @[36rem]/programme:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 items-center gap-3 [overflow-wrap:anywhere]">
            {/* У курса AI Engineering рядом с названием его знак (решение владельца 09.10.2026). */}
            {courseMark ? (
              <CourseMark className="size-10 shrink-0 sm:size-12" />
            ) : null}
            <div className="min-w-0">
              <h1 className="break-words text-xl font-semibold leading-tight tracking-[-0.025em] sm:text-2xl">
                {name}
              </h1>
              <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
                {meta}
              </p>
            </div>
          </div>
          {purchase}
        </div>
        <ProgrammeProgress />
      </header>

      {children}
    </div>
  );
}
