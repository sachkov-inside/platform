"use client";

import {
  Home,
  LibraryBig,
  Map,
  PenLine,
  Search,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { InsideBrand } from "./inside-brand";

type ApplicationNavigationIcon = "home" | "library" | "map" | "pen" | "profile";

export interface ApplicationNavigationItem {
  readonly href: Route;
  readonly icon: ApplicationNavigationIcon;
  readonly label: string;
}

export interface ApplicationShellProps {
  readonly children: ReactNode;
  readonly currentPath: string;
  readonly navigationItems: readonly ApplicationNavigationItem[];
  readonly mobileNavigationItems: readonly ApplicationNavigationItem[];
  /** Desktop identity presentation supplied by the app adapter. */
  readonly accountSlot?: ReactNode;
}

const iconByName: Readonly<Record<ApplicationNavigationIcon, LucideIcon>> = {
  home: Home,
  library: LibraryBig,
  map: Map,
  pen: PenLine,
  profile: UserRound,
};

/** Public frame: desktop header, mobile bottom navigation, and one main landmark. */
export function ApplicationShell({
  children,
  currentPath,
  navigationItems,
  accountSlot,
  mobileNavigationItems,
}: ApplicationShellProps) {
  return (
    <div
      className="flex min-h-svh flex-col bg-background text-foreground lg:h-svh lg:overflow-hidden"
      data-public-shell
    >
      <a
        href="#content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        Перейти к содержанию
      </a>
      <header
        className="sticky top-0 z-40 hidden shrink-0 border-b border-border bg-background lg:block"
        data-public-header
      >
        <div className="mx-auto flex flex-wrap min-h-[4.75rem] max-w-[82.5rem] items-center gap-2 px-4 py-3 sm:gap-4 sm:px-7 lg:min-h-[5.5rem] lg:gap-6 lg:px-8 lg:py-4">
          <InsideBrand />
          <nav
            aria-label="Основная"
            className="hidden min-w-0 flex-wrap items-center gap-1 lg:flex"
          >
            {navigationItems.map((item) => (
              <NavigationLink
                currentPath={currentPath}
                item={item}
                key={item.href}
              />
            ))}
          </nav>
          <Link
            aria-label="Найти материал"
            href="/library"
            className="ml-auto inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-full text-sm text-muted-foreground no-underline hover:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring xl:w-auto"
          >
            <Search aria-hidden="true" className="size-5" />
            <span className="hidden xl:inline">Найти материал</span>
          </Link>
          <div className="shrink-0">
            {accountSlot ?? (
              <Link
                href="/account"
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Аккаунт
              </Link>
            )}
          </div>
        </div>
      </header>
      <MobileBottomNavigation
        currentPath={currentPath}
        items={mobileNavigationItems}
      />
      <main
        id="content"
        tabIndex={-1}
        className="mobile-scrollbar-hidden min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:[scrollbar-gutter:stable]"
      >
        <div className="mx-auto w-full max-w-[66rem] px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 sm:px-7 lg:px-10 lg:pb-20 lg:pt-9">
          {children}
        </div>
      </main>
    </div>
  );
}

function NavigationLink({
  currentPath,
  item,
}: {
  readonly currentPath: string;
  readonly item: ApplicationNavigationItem;
}) {
  return (
    <Link
      href={item.href}
      aria-current={isCurrentPath(currentPath, item.href) ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-[0.875rem] px-3.5 py-2.5 text-sm font-semibold no-underline transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
        isCurrentPath(currentPath, item.href) && "bg-muted text-action",
      )}
    >
      <span>{item.label}</span>
    </Link>
  );
}

function MobileBottomNavigation({
  currentPath,
  items,
}: {
  readonly currentPath: string;
  readonly items: readonly ApplicationNavigationItem[];
}) {
  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-[1.6rem] border border-black/8 bg-white/88 p-1.5 text-foreground shadow-floating-nav backdrop-blur-xl lg:hidden"
    >
      <div className="flex items-center justify-center gap-1">
        {items.map((item) => {
          const Icon = iconByName[item.icon];
          const current = isCurrentPath(currentPath, item.href);

          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-[1.15rem] px-3 text-xs font-semibold leading-none text-muted-foreground no-underline",
                "transition-[background,color,padding] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] active:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                current && "bg-primary px-5 text-white",
              )}
              href={item.href}
              key={item.href}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-5", current && "text-accent-bright")}
              />
              {current ? (
                <span className="min-w-0 break-words">{item.label}</span>
              ) : (
                <span className="sr-only">{item.label}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isCurrentPath(pathname: string, href: Route): boolean {
  if (href === "/") return pathname === href;
  if (
    href === "/library" &&
    ["/materials/", "/series/", "/topics/"].some((prefix) =>
      pathname.startsWith(prefix),
    )
  )
    return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
