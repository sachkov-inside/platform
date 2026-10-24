"use client";

import { Play } from "lucide-react";
import type { Route } from "next";
import { createContext, use, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import type { MaterialPreview } from "../model/material-preview";

/**
 * Урок программы, с которого читателю продолжать. Строки программы рисует сервер, а продолжение
 * личное и приходит в браузере, поэтому строка узнаёт его отсюда, а не из своих свойств.
 */
export interface ProductContinuation {
  readonly materialSlug: string;
  /** «Продолжить» — у читателя есть прогресс; «Начать обучение» — первый открытый урок. */
  readonly label: string;
}

type ProductContinuationView = ProductContinuation & {
  readonly reserved: boolean;
};

const ProductContinuationContext =
  createContext<ProductContinuationView | null>(null);

export function ProductContinuationProvider({
  children,
  continuation,
  reservePrevious = false,
}: {
  readonly children: ReactNode;
  readonly continuation: ProductContinuation | null;
  /** При отказе личного чтения сохраняется только место прежней кнопки, без действия. */
  readonly reservePrevious?: boolean;
}) {
  const [previous, setPrevious] = useState(continuation);
  if (
    !reservePrevious &&
    (previous?.materialSlug !== continuation?.materialSlug ||
      previous?.label !== continuation?.label)
  )
    setPrevious(continuation);
  const current = continuation ?? (reservePrevious ? previous : null);
  return (
    <ProductContinuationContext
      value={
        current === null
          ? null
          : { ...current, reserved: continuation === null }
      }
    >
      {children}
    </ProductContinuationContext>
  );
}

/** Строка программы: урок продолжения раскрыт — светлый фон и рамка, внутри кнопка. */
export function ProductRowArticle({
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
  const continuation = use(ProductContinuationContext);
  const current = continuation?.materialSlug === slug && !continuation.reserved;
  return (
    <article
      className={cn(
        className,
        current && "bg-card ring-1 ring-border shadow-card hover:bg-card",
      )}
      data-material-availability={availability}
      data-material-id={slug}
      data-material-slug={slug}
      data-material-variant="product"
    >
      {children}
    </article>
  );
}

/**
 * Кнопка в раскрытой строке урока продолжения: «Продолжить» или «Начать обучение» прямо в списке
 * программы (решение владельца 09.10.2026). У остальных строк её нет.
 */
export function ProductContinuationAction({
  href,
  slug,
}: {
  readonly href: Route;
  readonly slug: string;
}) {
  const continuation = use(ProductContinuationContext);
  if (continuation?.materialSlug !== slug) return null;
  const className =
    "relative z-10 mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[0.8125rem] font-semibold text-primary-foreground no-underline hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm";
  const contents = (
    <>
      <Play aria-hidden="true" className="size-3 fill-current" />
      {continuation.label}
    </>
  );
  return continuation.reserved ? (
    <div
      aria-hidden="true"
      className={`${className} invisible`}
      data-product-continuation-space
    >
      {contents}
    </div>
  ) : (
    <IntentPrefetchLink
      className={className}
      data-product-continuation
      href={href}
    >
      {contents}
    </IntentPrefetchLink>
  );
}
