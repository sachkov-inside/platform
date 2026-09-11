"use client";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

import type { AccountSection } from "../model/account-sections";

export interface AccountSectionNavProps {
  readonly sections: readonly AccountSection[];
  readonly currentHref: string;
}

/**
 * Один список разделов в двух видах: постоянная боковая навигация на десктопе и раскрывающийся
 * список на телефоне. Второй оболочки не появляется — это навигация внутри принятой.
 */
export function AccountSectionNav({
  sections,
  currentHref,
}: AccountSectionNavProps) {
  // Список помнит, для какого адреса он открыт, поэтому открытый раздел закрывает его сам.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = openedFor === currentHref;
  const listId = useId();
  const current = sections.find((section) => section.href === currentHref);

  return (
    <>
      <nav
        aria-label="Разделы кабинета"
        className="mb-6 lg:hidden"
        data-account-section-nav="mobile"
      >
        <button
          aria-controls={listId}
          aria-expanded={open}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 text-left text-sm font-semibold shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => {
            setOpenedFor(open ? null : currentHref);
          }}
          type="button"
        >
          <span className="min-w-0">
            <span className="block text-xs font-medium text-muted-foreground">
              Личный кабинет
            </span>
            <span className="block truncate">{current?.label ?? "Разделы"}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
        <ul
          className={cn("mt-2 grid gap-1", !open && "hidden")}
          id={listId}
        >
          {sections.map((section) => (
            <li key={section.id}>
              <SectionLink
                className="min-h-14 flex-col items-start justify-center gap-0.5 rounded-xl border border-border bg-card px-4 py-2"
                current={section.href === currentHref}
                section={section}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {section.summary}
                </span>
              </SectionLink>
            </li>
          ))}
        </ul>
      </nav>

      <nav
        aria-label="Разделы кабинета"
        className="hidden lg:block"
        data-account-section-nav="desktop"
      >
        <p className="px-3.5 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Личный кабинет
        </p>
        <ul className="mt-3 grid gap-1">
          {sections.map((section) => (
            <li key={section.id}>
              <SectionLink
                className="min-h-11 items-center px-3.5 py-2.5"
                current={section.href === currentHref}
                section={section}
              />
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function SectionLink({
  children,
  className,
  current,
  section,
}: {
  readonly children?: ReactNode;
  readonly className: string;
  readonly current: boolean;
  readonly section: AccountSection;
}) {
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex rounded-[0.875rem] text-sm font-semibold no-underline transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
        current && "bg-muted text-action",
        className,
      )}
      href={section.href}
    >
      <span className="min-w-0">
        <span className="block truncate">{section.label}</span>
        {children}
      </span>
    </Link>
  );
}
