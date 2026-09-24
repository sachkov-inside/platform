"use client";

import { Play } from "lucide-react";
import { createContext, use, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import type { MaterialPreview } from "../model/material-preview";

/**
 * Урок программы, с которого читателю продолжать. Строки программы рисует сервер, а продолжение
 * личное и приходит в браузере, поэтому строка узнаёт его отсюда, а не из своих свойств.
 */
const SeriesContinuationContext = createContext<string | null>(null);

export function SeriesContinuationProvider({
  children,
  materialSlug,
}: {
  readonly children: ReactNode;
  readonly materialSlug: string | null;
}) {
  return <SeriesContinuationContext value={materialSlug}>{children}</SeriesContinuationContext>;
}

/** Строка программы: у урока продолжения другой фон. */
export function SeriesRowArticle({
  availability,
  children,
  className,
  slug,
}: {
  /** Доступ читателя; `pending`, пока личная часть программы ещё идёт. */
  readonly availability: MaterialPreview["availability"] | "pending";
  readonly children: ReactNode;
  readonly className: string;
  readonly slug: string;
}) {
  const current = use(SeriesContinuationContext) === slug;
  return (
    <article
      className={cn(className, current && "bg-secondary")}
      data-material-availability={availability}
      data-material-id={slug}
      data-material-slug={slug}
      data-material-variant="series"
    >
      {children}
    </article>
  );
}

/** Место метки «Продолжить» в строке программы: занято всегда, заполнено у урока продолжения. */
export function SeriesContinuationSlot({ slug }: { readonly slug: string }) {
  const current = use(SeriesContinuationContext) === slug;
  return (
    <span className="flex h-5 items-center text-xs font-semibold text-action" data-series-continuation-slot>
      {current ? (
        <>
          <Play aria-hidden="true" className="size-3.5 fill-current @min-[30rem]/series-entry:hidden" />
          <span className="sr-only @min-[30rem]/series-entry:not-sr-only">Продолжить</span>
        </>
      ) : null}
    </span>
  );
}
