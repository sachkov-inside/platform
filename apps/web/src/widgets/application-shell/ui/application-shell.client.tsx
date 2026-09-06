"use client";

import {
  Home,
  LibraryBig,
  Map,
  Menu,
  PenLine,
  Search,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
  /** Identity presentation supplied by the app adapter, shared across viewport sizes. */
  readonly accountSlot?: ReactNode;
}

const iconByName: Readonly<Record<ApplicationNavigationIcon, LucideIcon>> = {
  home: Home,
  library: LibraryBig,
  map: Map,
  pen: PenLine,
  profile: UserRound,
};

/** Public frame: one header, one route-aware navigation model, one scrolling main. */
export function ApplicationShell({
  children,
  currentPath,
  navigationItems,
  accountSlot,
}: ApplicationShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Sticky reader controls share the header's actual height, including text zoom and wrapping.
  useEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (shell === null || header === null) return;
    const updateHeight = () => {
      shell.style.setProperty("--public-header-height", `${String(header.getBoundingClientRect().height)}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => { observer.disconnect(); };
  }, []);

  return (
    <div
      className="flex min-h-svh flex-col bg-background text-foreground lg:h-svh lg:overflow-hidden"
      data-public-shell
      ref={shellRef}
    >
      <a
        href="#content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        Перейти к содержанию
      </a>
      <header
        className="sticky top-0 z-40 shrink-0 border-b border-border bg-background"
        data-public-header
        ref={headerRef}
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
          <MobileNavigation
            key={currentPath}
            currentPath={currentPath}
            items={navigationItems}
          />
        </div>
      </header>
      <main
        id="content"
        tabIndex={-1}
        className="mobile-scrollbar-hidden min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:[scrollbar-gutter:stable]"
      >
        <div className="mx-auto w-full max-w-[66rem] px-4 pb-16 pt-6 sm:px-7 lg:px-10 lg:pb-20 lg:pt-9">
          {children}
        </div>
      </main>
    </div>
  );
}

function NavigationLink({
  currentPath,
  item,
  mobile = false,
  onNavigate,
}: {
  readonly currentPath: string;
  readonly item: ApplicationNavigationItem;
  readonly mobile?: boolean;
  readonly onNavigate?: () => void;
}) {
  const Icon = iconByName[item.icon];
  return (
    <Link
      href={item.href}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={isCurrentPath(currentPath, item.href) ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-[0.875rem] px-3.5 py-2.5 text-sm font-semibold no-underline transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
        isCurrentPath(currentPath, item.href) && "bg-muted text-action",
      )}
    >
      {mobile && <Icon aria-hidden="true" className="size-5 shrink-0" />}
      <span>{item.label}</span>
    </Link>
  );
}

function MobileNavigation({
  currentPath,
  items,
}: {
  readonly currentPath: string;
  readonly items: readonly ApplicationNavigationItem[];
}) {
  const [open, setOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Открыть меню"
        className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          data-public-shell
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            navigationRef.current?.querySelector("a")?.focus();
          }}
          aria-describedby={undefined}
          className="fixed left-4 right-4 top-4 z-50 mx-auto max-h-[calc(100svh-2rem)] max-w-md overflow-y-auto rounded-3xl bg-background p-6 text-foreground shadow-floating-nav"
        >
          <Dialog.Title className="pr-12 text-xl font-bold">
            Разделы
          </Dialog.Title>
          <nav
            ref={navigationRef}
            aria-label="Мобильная навигация"
            className="mt-6 flex flex-col gap-2"
          >
            {items.map((item) => (
              <NavigationLink
                currentPath={currentPath}
                item={item}
                mobile
                key={item.href}
                onNavigate={() => {
                  setOpen(false);
                }}
              />
            ))}
          </nav>
          <Dialog.Close
            aria-label="Закрыть меню"
            className="absolute right-3 top-3 grid size-11 place-items-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
