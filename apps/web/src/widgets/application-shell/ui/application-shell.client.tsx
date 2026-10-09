"use client";

import {
  Bookmark,
  GraduationCap,
  Home,
  LibraryBig,
  Map,
  PenLine,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { InsideBrand } from "./inside-brand";
import { PublicFooter } from "./public-footer";

type ApplicationNavigationIcon =
  "bookmark" | "course" | "home" | "library" | "map" | "pen" | "profile";

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
  course: GraduationCap,
  home: Home,
  library: LibraryBig,
  map: Map,
  pen: PenLine,
  profile: UserRound,
};

/** Public frame: desktop header, mobile top header, and one main landmark. */
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
      data-application-shell
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
          {/* Поиска в шапке нет: материалы ищут полем на Главной (решение владельца 30.09.2026). */}
          <div className="ml-auto shrink-0">
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
      <MobileTopNavigation
        currentPath={currentPath}
        items={mobileNavigationItems}
        onNavigate={onMobileNavigate}
      />
      <main
        id="content"
        tabIndex={-1}
        className="mobile-scrollbar-hidden flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:[scrollbar-gutter:stable_both-edges]"
      >
        {/* The page fills the viewport, so a short page still keeps the footer at the bottom. */}
        <div className="public-page-container mx-auto flex w-full flex-1 flex-col pb-[calc(2.5rem+env(safe-area-inset-bottom)+var(--storage-notice-space,0px))] pt-6 lg:shrink-0 lg:pb-[calc(5rem+var(--storage-notice-space,0px))] lg:pt-8">
          {/* Pages keep ordinary block flow; only this wrapper is a flex item. */}
          <div className="min-w-0">{children}</div>
          <div className="public-footer-slot mt-auto pt-16">
            <PublicFooter />
          </div>
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

/**
 * Шапка телефона и планшета вместо нижней панели (решение владельца 09.10.2026): логотип ведёт на
 * Главную, справа значки разделов — «Курс», «Закладки», «Профиль». Нижняя панель есть только в
 * прохождении курса, у программы и урока своя. Страница курса, покупка и прохождение убирают эту
 * шапку компонентом `HideMobileNavigation`: у них свои верхние элементы.
 */
function MobileTopNavigation({
  currentPath,
  items,
  onNavigate,
}: {
  readonly currentPath: string;
  readonly items: readonly ApplicationNavigationItem[];
  readonly onNavigate?: ((href: Route) => void) | undefined;
}) {
  const home = items.find((item) => item.icon === "home");
  const sections = items.filter((item) => item.icon !== "home");
  const navigate =
    onNavigate === undefined
      ? undefined
      : (href: Route) => (event: { preventDefault: () => void }) => {
          event.preventDefault();
          onNavigate(href);
        };
  return (
    <header
      className="mobile-navigation sticky top-0 z-40 border-b border-border bg-background/92 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden"
      data-mobile-header
    >
      <div className="public-page-container mx-auto flex min-h-14 flex-wrap items-center justify-between gap-x-3">
        <Link
          aria-label="Главная"
          className="flex shrink-0 items-baseline gap-[0.23em] rounded-md text-lg font-extrabold leading-none tracking-[-0.05em] no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          href={home?.href ?? "/"}
          scroll={onNavigate === undefined}
          {...(navigate === undefined || home === undefined
            ? {}
            : { onNavigate: navigate(home.href) })}
        >
          <span>Sachkov</span>
          <span className="text-action">Inside</span>
        </Link>
        <nav aria-label="Мобильная навигация">
          <ul className="flex flex-wrap items-center gap-1">
            {sections.map((item) => {
              const Icon = iconByName[item.icon];
              const current = isCurrentPath(currentPath, item.href);
              return (
                <li key={item.href}>
                  <Link
                    aria-current={current ? "page" : undefined}
                    aria-label={item.label}
                    className={cn(
                      "mobile-navigation-link relative grid size-11 place-items-center rounded-full text-muted-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      current && "bg-primary text-primary-foreground",
                    )}
                    href={item.href}
                    scroll={onNavigate === undefined}
                    {...(navigate === undefined
                      ? {}
                      : { onNavigate: navigate(item.href) })}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "size-5 shrink-0",
                        current && "text-accent-bright",
                      )}
                    />
                    {item.badge === true && !current ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-white"
                      />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}

function isCurrentPath(pathname: string, route: Route): boolean {
  const href = route.split("?")[0] ?? route;
  if (href === "/" && pathname === "/") return true;
  if (
    href === "/" &&
    ["/materials/", "/products/", "/topics/"].some((prefix) =>
      pathname.startsWith(prefix),
    )
  )
    return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
