import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { IntentPrefetchLink } from "./intent-prefetch-link.client";
import { cn } from "@/shared/lib/utils";
import { ReaderOriginLink } from "./reader-history.client";

export interface BreadcrumbItem {
  readonly label: string;
  readonly fullLabel?: string | undefined;
  readonly href?: Route;
  readonly restoreOrigin?: boolean;
}

/** Visually hidden on phones, still read by assistive technology. */
const phoneHidden =
  "max-sm:absolute max-sm:size-px max-sm:overflow-hidden max-sm:whitespace-nowrap max-sm:[clip-path:inset(50%)]";

/**
 * Logical location, independent of the browser's chronological Back history. Compact crumbs on a
 * phone keep the first place and the current page and fold the middle into an ellipsis.
 */
export function Breadcrumbs({
  items,
  compact = false,
}: {
  readonly items: readonly BreadcrumbItem[];
  /** Reader already renders the current title immediately below the location. */
  readonly compact?: boolean;
}) {
  const folds = compact && items.length > 2;
  const squeezed = compact && items.length > 1;
  return (
    <nav aria-label="Хлебные крошки" className="min-w-0">
      <ol
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-muted-foreground",
          squeezed && "max-sm:flex-nowrap max-sm:gap-x-1",
        )}
      >
        {items.map((item, index) => {
          const Link =
            item.restoreOrigin === true ? ReaderOriginLink : IntentPrefetchLink;
          const first = index === 0;
          const last = index === items.length - 1;
          const middle = folds && !first && !last;
          const crumb = (
            <li
              key={`${String(index)}:${item.label}`}
              className={cn(
                "flex min-w-0 max-w-full items-center gap-2",
                squeezed && "max-sm:gap-1",
                middle && phoneHidden,
                // On a phone the place takes up to half the row and the current page the rest.
                squeezed && first && "max-sm:max-w-[50%] max-sm:shrink-0",
                squeezed && last && "max-sm:flex-1",
              )}
            >
              {first ? null : (
                <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
              )}
              {item.href === undefined ? (
                <span
                  aria-current="page"
                  title={item.label}
                  className={cn(
                    "min-w-0 max-w-[12rem] truncate text-foreground sm:max-w-[16rem]",
                    squeezed && "max-sm:max-w-none",
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  aria-label={
                    item.fullLabel === undefined ||
                    item.fullLabel === item.label
                      ? undefined
                      : `${item.label}: ${item.fullLabel}`
                  }
                  title={item.fullLabel ?? item.label}
                  className={cn(
                    "inline-flex min-h-11 min-w-0 max-w-[8rem] items-center underline-offset-4 hover:text-foreground hover:underline sm:max-w-[12rem]",
                    squeezed && first && "max-sm:max-w-full",
                  )}
                  href={item.href}
                >
                  <span className="truncate">{item.label}</span>
                </Link>
              )}
            </li>
          );
          // On a phone the folded middle shows as one ellipsis before the current page; the
          // folded places stay in the list for assistive technology.
          return folds && last ? (
            <Fragment key={`${String(index)}:${item.label}`}>
              <li
                aria-hidden="true"
                className="flex shrink-0 items-center gap-1 sm:hidden"
              >
                <ChevronRight className="size-3 shrink-0" />
                <span>…</span>
              </li>
              {crumb}
            </Fragment>
          ) : (
            crumb
          );
        })}
      </ol>
    </nav>
  );
}
