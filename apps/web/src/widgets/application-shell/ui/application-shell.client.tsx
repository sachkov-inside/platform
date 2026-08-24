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
  /** Avatar shown in the account affordance. */
  readonly accountAvatarUrl: string;
  /** Human-readable account name used by visible and accessible labels. */
  readonly accountLabel: string;
  readonly children: ReactNode;
  /** Current route used to expose the active navigation item. */
  readonly currentPath: string;
  /** Desktop navigation topology; both variants keep mobile bottom navigation. */
  readonly layout: "header" | "sidebar";
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
  accountAvatarUrl,
  accountLabel,
  children,
  currentPath,
  layout,
  navigationItems,
  sidebarDefaultPinned = false,
}: ApplicationShellProps) {
  if (layout === "header") {
    return (
      <ShellFrame>
        <HeaderNavigation
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          currentPath={currentPath}
          items={navigationItems}
        />
        <ShellMain>{children}</ShellMain>
        <MobileBottomNavigation currentPath={currentPath} items={navigationItems} />
      </ShellFrame>
    );
  }

  return (
    <ShellFrame fullBleed>
      <div className="flex min-h-svh items-start bg-background md:h-svh md:min-h-0 md:overflow-hidden md:bg-card">
        <Sidebar defaultPinned={sidebarDefaultPinned}>
          <SidebarBody>
            <SidebarContents
              accountAvatarUrl={accountAvatarUrl}
              accountLabel={accountLabel}
              currentPath={currentPath}
              items={navigationItems}
            />
          </SidebarBody>
        </Sidebar>
        <ShellMain nested>{children}</ShellMain>
      </div>
      <MobileBottomNavigation currentPath={currentPath} items={navigationItems} />
    </ShellFrame>
  );
}

function ShellFrame({
  children,
  fullBleed = false,
}: {
  readonly children: ReactNode;
  readonly fullBleed?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-h-svh bg-background text-foreground",
        !fullBleed && "md:p-5",
      )}
    >
      <a
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform focus:translate-y-0"
        href="#workshop-content"
      >
        Перейти к содержанию
      </a>
      {children}
    </div>
  );
}

function ShellMain({
  children,
  nested = false,
}: {
  readonly children: ReactNode;
  readonly nested?: boolean;
}) {
  return (
    <main
      className={cn(
        "min-h-svh min-w-0 flex-1 bg-background pb-[calc(5rem+env(safe-area-inset-bottom))] md:bg-card md:pb-0",
        nested
          ? "md:h-full md:min-h-0 md:overflow-x-hidden md:overflow-y-auto md:overscroll-y-contain md:[scrollbar-gutter:stable]"
          : "md:min-h-[calc(100svh-2.5rem)]",
      )}
      id="workshop-content"
      tabIndex={-1}
    >
      <div className="mx-3 my-3 w-auto max-w-6xl rounded-2xl border border-border bg-card px-5 py-7 sm:mx-5 sm:px-8 sm:py-10 md:mx-auto md:my-0 md:w-full md:rounded-none md:border-0 md:bg-transparent md:py-12 lg:px-12 lg:py-14">
        {children}
      </div>
    </main>
  );
}

interface NavigationProps {
  readonly accountAvatarUrl: string;
  readonly accountLabel: string;
  readonly currentPath: string;
  readonly items: readonly ApplicationNavigationItem[];
}

function SidebarContents({
  accountAvatarUrl,
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
        <AccountPreview avatarUrl={accountAvatarUrl} label={accountLabel} />
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

function HeaderNavigation({
  accountAvatarUrl,
  accountLabel,
  currentPath,
  items,
}: NavigationProps) {
  return (
    <header className="sticky top-5 z-30 mx-5 hidden max-w-6xl items-center justify-between gap-4 rounded-2xl border border-border bg-card/95 p-2 shadow-[0_0.75rem_2.5rem_oklch(0.22_0.02_125/0.08)] backdrop-blur md:flex xl:mx-auto">
      <Link
        className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold tracking-[-0.025em] no-underline"
        href="/"
      >
        Sachkov Inside
      </Link>
      <nav aria-label="Основная" className="hidden items-center gap-1 md:flex">
        {items.map((item) => (
          <HeaderLink
            current={isCurrentPath(currentPath, item.href)}
            href={item.href}
            key={item.href}
            label={item.label}
          />
        ))}
      </nav>
      <div>
        <AccountChip avatarUrl={accountAvatarUrl} label={accountLabel} />
      </div>
    </header>
  );
}

function AccountPreview({
  avatarUrl,
  label,
}: {
  readonly avatarUrl: string;
  readonly label: string;
}) {
  const { open } = useSidebar();

  return (
    <div
      aria-label={`Текущий профиль: ${label}`}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground/72"
      role="group"
    >
      <AccountAvatar avatarUrl={avatarUrl} label={label} />
      {open ? <span className="hidden whitespace-nowrap md:inline">{label}</span> : null}
    </div>
  );
}

function AccountChip({ avatarUrl, label }: { readonly avatarUrl: string; readonly label: string }) {
  return (
    <div
      aria-label={`Текущий профиль: ${label}`}
      className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground"
      role="group"
    >
      <AccountAvatar avatarUrl={avatarUrl} label={label} size="small" />
      <span>{label}</span>
    </div>
  );
}

function AccountAvatar({
  avatarUrl,
  label,
  size = "regular",
}: {
  readonly avatarUrl: string;
  readonly label: string;
  readonly size?: "regular" | "small";
}) {
  return (
    // The workshop accepts an arbitrary user-supplied avatar URL, so native img is intentional.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className={cn(
        "shrink-0 rounded-full bg-sidebar-accent object-cover",
        size === "small" ? "size-6" : "size-8",
      )}
      height={size === "small" ? 24 : 32}
      loading="lazy"
      src={avatarUrl}
      title={`Аватар: ${label}`}
      width={size === "small" ? 24 : 32}
    />
  );
}

function MobileBottomNavigation({
  currentPath,
  items,
}: Pick<NavigationProps, "currentPath" | "items">) {
  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="grid grid-cols-3 px-2 pt-1.5">
        {items.map((item) => {
          const Icon = iconByName[item.icon];
          const current = isCurrentPath(currentPath, item.href);

          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[0.6875rem] font-medium text-muted-foreground no-underline",
                "active:bg-muted focus-visible:outline-ring",
                current && "text-foreground",
              )}
              href={item.href}
              key={item.href}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-5", current && "text-accent")}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

interface HeaderLinkProps {
  readonly current: boolean;
  readonly href: Route;
  readonly label: string;
}

function HeaderLink({ current, href, label }: HeaderLinkProps) {
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground no-underline transition-colors",
        "hover:bg-muted hover:text-foreground",
        current && "bg-muted text-foreground",
      )}
      href={href}
    >
      {label}
      {current ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 bottom-1 h-0.5 rounded-full bg-accent"
        />
      ) : null}
    </Link>
  );
}

function isCurrentPath(pathname: string, href: Route): boolean {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
