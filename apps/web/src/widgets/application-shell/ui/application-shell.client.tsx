"use client";

import {
  Home,
  LibraryBig,
  Map,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
  SidebarToggle,
  useSidebar,
} from "@/shared/ui/sidebar";

type ApplicationNavigationIcon = "home" | "library" | "map";

export interface ApplicationNavigationItem {
  readonly href: Route;
  readonly icon: ApplicationNavigationIcon;
  readonly label: string;
}

export interface ApplicationShellProps {
  /** Human-readable account name used by visible and accessible labels. */
  readonly accountLabel: string;
  readonly children: ReactNode;
  /** Current route used to expose the active navigation item. */
  readonly currentPath: string;
  readonly navigationItems: readonly ApplicationNavigationItem[];
  /** Initial pinned state for the expandable desktop sidebar. */
  readonly sidebarDefaultPinned?: boolean;
}

const iconByName: Readonly<Record<ApplicationNavigationIcon, LucideIcon>> = {
  home: Home,
  library: LibraryBig,
  map: Map,
};

/** Responsive product frame that owns primary navigation and the main landmark. */
export function ApplicationShell({
  accountLabel,
  children,
  currentPath,
  navigationItems,
  sidebarDefaultPinned = false,
}: ApplicationShellProps) {
  return (
    <ShellFrame>
      <div className="flex min-h-svh items-start bg-background md:h-svh md:min-h-0 md:overflow-hidden md:bg-card">
        <Sidebar defaultPinned={sidebarDefaultPinned}>
          <SidebarBody>
            <SidebarContents
              accountLabel={accountLabel}
              currentPath={currentPath}
              items={navigationItems}
            />
          </SidebarBody>
        </Sidebar>
        <ShellMain>{children}</ShellMain>
      </div>
      <MobileBottomNavigation currentPath={currentPath} items={navigationItems} />
    </ShellFrame>
  );
}

function ShellFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] focus:translate-y-0 motion-reduce:transition-none"
        href="#content"
      >
        Перейти к содержанию
      </a>
      {children}
    </div>
  );
}

function ShellMain({ children }: { readonly children: ReactNode }) {
  return (
    <main
      className={cn(
        "min-h-svh min-w-0 flex-1 bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:bg-card md:pb-0",
        "md:h-full md:min-h-0 md:overflow-x-hidden md:overflow-y-auto md:overscroll-y-contain md:[scrollbar-gutter:stable]",
      )}
      id="content"
      tabIndex={-1}
    >
      <div className="mx-3 my-3 w-auto max-w-6xl rounded-2xl border border-border bg-card px-5 py-7 sm:mx-5 sm:px-8 sm:py-10 md:mx-auto md:my-0 md:w-full md:rounded-none md:border-0 md:bg-transparent md:py-12 lg:px-12 lg:py-14">
        {children}
      </div>
    </main>
  );
}

interface NavigationProps {
  readonly accountLabel: string;
  readonly currentPath: string;
  readonly items: readonly ApplicationNavigationItem[];
}

function SidebarContents({
  accountLabel,
  currentPath,
  items,
}: NavigationProps) {
  const { open } = useSidebar();

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col p-3">
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <div
          className={cn(
            "flex min-h-11 items-center gap-2",
            open ? "justify-between px-2" : "justify-center",
          )}
        >
          <InsideBrand />
          {open ? <SidebarToggle /> : null}
        </div>
        <nav aria-label="Основная" className="flex flex-col gap-1">
          {items.map((item) => {
            const Icon = iconByName[item.icon];

            return (
              <SidebarLink
                current={isCurrentPath(currentPath, item.href)}
                href={item.href}
                icon={<Icon />}
                key={item.href}
                label={item.label}
              />
            );
          })}
        </nav>
      </div>
      <div className="shrink-0 border-t border-sidebar-border pt-3">
        <AccountPreview label={accountLabel} />
      </div>
    </div>
  );
}

function InsideBrand() {
  const { open } = useSidebar();

  return (
    <Link
      aria-label="Sachkov Inside"
      className={cn(
        "shrink-0 text-sidebar-foreground no-underline",
        open
          ? "min-w-0 truncate rounded-md text-sm font-semibold tracking-[-0.025em]"
          : "grid size-8 place-items-center rounded-lg bg-sidebar-foreground text-xs font-extrabold text-sidebar",
      )}
      href="/"
    >
      {open ? "Sachkov Inside" : "S"}
    </Link>
  );
}

function AccountPreview({ label }: { readonly label: string }) {
  const { open } = useSidebar();

  return (
    <div
      aria-label={`Текущий профиль: ${label}`}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground/72"
      role="group"
    >
      <AccountInitials label={label} />
      {open ? <span className="hidden whitespace-nowrap md:inline">{label}</span> : null}
    </div>
  );
}

function AccountInitials({ label }: { readonly label: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent font-mono text-xs font-semibold text-sidebar-accent-foreground"
    >
      {label.trim().slice(0, 1).toLocaleUpperCase("ru")}
    </span>
  );
}

function MobileBottomNavigation({
  currentPath,
  items,
}: Pick<NavigationProps, "currentPath" | "items">) {
  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="grid grid-cols-3 px-2 pt-1">
        {items.map((item) => {
          const Icon = iconByName[item.icon];
          const current = isCurrentPath(currentPath, item.href);

          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[0.625rem] font-medium leading-none text-muted-foreground no-underline",
                "transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] active:bg-muted focus-visible:outline-ring motion-reduce:transition-none",
                current && "text-foreground",
              )}
              href={item.href}
              key={item.href}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-4.5", current && "text-accent")}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isCurrentPath(pathname: string, href: Route): boolean {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
