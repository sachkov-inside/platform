"use client";

import {
  Bookmark,
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

type ApplicationNavigationIcon = "bookmark" | "home" | "library" | "map" | "pen" | "profile";

export interface ApplicationNavigationItem {
  readonly href: Route;
  readonly icon: ApplicationNavigationIcon;
  readonly label: string;
  /** Незакрытое дело за этим пунктом: точка подталкивает открыть его. */
  readonly badge?: boolean;
}

export interface ApplicationShellProps {
  readonly children: ReactNode;
  readonly currentPath: string;
  readonly navigationItems: readonly ApplicationNavigationItem[];
  readonly mobileNavigationItems: readonly ApplicationNavigationItem[];
  readonly onMobileNavigate?: (href: Route) => void;
  /** Desktop identity presentation supplied by the app adapter. */
  readonly accountSlot?: ReactNode;
}

const iconByName: Readonly<Record<ApplicationNavigationIcon, LucideIcon>> = {
  bookmark: Bookmark,
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
  onMobileNavigate,
}: ApplicationShellProps) {
  return (
    <div
      className="flex min-h-svh flex-col bg-background text-foreground lg:h-svh lg:overflow-hidden"
      data-public-shell
    >
      <a
        href="#content"
        className="fixed left-4 top-4 z-[100] max-w-[calc(100vw-2rem)] -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        Перейти к содержанию
      </a>
      <header
        className="public-header sticky top-0 z-40 hidden shrink-0 border-b border-border bg-background lg:block"
        data-public-header
      >
        <div className="public-page-container mx-auto flex min-h-20 flex-wrap items-center gap-2 py-3 sm:gap-4 lg:gap-6 lg:py-4">
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
        onNavigate={onMobileNavigate}
      />
      <main
        id="content"
        tabIndex={-1}
        className="mobile-scrollbar-hidden min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:[scrollbar-gutter:stable_both-edges]"
      >
        <div className="public-page-container mx-auto w-full pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 lg:pb-20 lg:pt-8">
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
  onNavigate,
}: {
  readonly currentPath: string;
  readonly items: readonly ApplicationNavigationItem[];
  readonly onNavigate?: ((href: Route) => void) | undefined;
}) {
  const activeIndex = items.findIndex((item) => isCurrentPath(currentPath, item.href));
  const totalParts = items.length;
  return (
    <nav
      aria-label="Мобильная навигация"
      className="mobile-navigation fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-max max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-[1.6rem] border border-black/8 bg-white/88 p-1.5 text-foreground shadow-floating-nav backdrop-blur-xl lg:hidden"
    >
      <div
        className="mobile-navigation-items relative grid"
        style={{ gridTemplateColumns: `repeat(${String(totalParts)}, 3.375rem)` }}
      >
        <span
          aria-hidden="true"
          className="mobile-navigation-indicator pointer-events-none absolute inset-y-0 left-0 rounded-[1.15rem] bg-primary"
          style={{
            width: `${String(1 / totalParts * 100)}%`,
            transform: `translateX(${String(Math.max(0, activeIndex) * 100)}%)`,
            opacity: activeIndex < 0 ? 0 : 1,
          }}
        />
        {items.map((item) => {
          const Icon = iconByName[item.icon];
          const current = isCurrentPath(currentPath, item.href);

          return (
            <Link
              aria-current={current ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "mobile-navigation-link relative flex min-h-12 min-w-0 items-center justify-center rounded-[1.15rem] px-2 text-xs font-semibold leading-none text-muted-foreground no-underline",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                current && "text-white",
              )}
              href={item.href}
              key={item.href}
              prefetch={true}
              scroll={onNavigate === undefined}
              onNavigate={(event) => {
                if (onNavigate === undefined) return;
                event.preventDefault();
                onNavigate(item.href);
              }}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-6 shrink-0", current && "text-accent-bright")}
              />
              {item.badge === true && !current ? (
                <span
                  aria-hidden="true"
                  className="absolute right-3 top-2.5 size-2 rounded-full bg-accent ring-2 ring-white"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isCurrentPath(pathname: string, href: Route): boolean {
  href = href.split("?")[0] as Route;
  if (href === "/") return pathname === href;
  if (
    href === "/library" &&
    ["/materials/", "/guides/", "/series/", "/topics/"].some((prefix) =>
      pathname.startsWith(prefix),
    )
  )
    return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
