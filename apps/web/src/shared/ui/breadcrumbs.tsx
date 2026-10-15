import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { IntentPrefetchLink } from "./intent-prefetch-link.client";
import { ReaderOriginLink } from "./reader-history.client";

export interface BreadcrumbItem {
  readonly label: string;
  readonly fullLabel?: string | undefined;
  readonly href?: Route;
  readonly restoreOrigin?: boolean;
}

/** Logical location, independent of the browser's chronological Back history. */
export function Breadcrumbs({
  items,
}: {
  readonly items: readonly BreadcrumbItem[];
}) {
  return (
    <nav aria-label="Хлебные крошки" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-muted-foreground">
        {items.map((item, index) => {
          const Link =
            item.restoreOrigin === true ? ReaderOriginLink : IntentPrefetchLink;
          return (
            <li
              key={`${String(index)}:${item.label}`}
              className="flex min-w-0 max-w-full items-center gap-2"
            >
              {index === 0 ? null : (
                <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
              )}
              {item.href === undefined ? (
                <span
                  aria-current="page"
                  title={item.label}
                  className="min-w-0 max-w-[12rem] truncate text-foreground sm:max-w-[16rem]"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  aria-label={item.fullLabel}
                  title={item.fullLabel ?? item.label}
                  className="inline-flex min-h-11 min-w-0 max-w-[8rem] items-center underline-offset-4 hover:text-foreground hover:underline sm:max-w-[12rem]"
                  href={item.href}
                >
                  <span className="truncate">{item.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
