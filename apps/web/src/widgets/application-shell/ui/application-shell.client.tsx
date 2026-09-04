"use client";

import {
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
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
  SidebarToggle,
  useSidebar,
} from "@/shared/ui/sidebar";

type ApplicationNavigationIcon = "home" | "library" | "map" | "pen" | "profile";

export interface ApplicationNavigationItem {
  readonly href: Route;
  readonly icon: ApplicationNavigationIcon;
  readonly label: string;
}

export interface ApplicationShellProps {
  /** Human-readable account name used by visible and accessible labels. */
  readonly accountLabel?: string | undefined;
  readonly children: ReactNode;
  /** Current route used to expose the active navigation item. */
  readonly currentPath: string;
  readonly navigationItems: readonly ApplicationNavigationItem[];
  readonly mobileNavigationItems?: readonly ApplicationNavigationItem[];
  /** Server-owned identity control rendered inside the desktop sidebar. */
  readonly desktopAccountSlot?: ReactNode | undefined;
  /** Server-owned identity control rendered beside mobile navigation. */
  readonly mobileAccountSlot?: ReactNode | undefined;
  /** Initial pinned state for the expandable desktop sidebar. */
  readonly sidebarDefaultPinned?: boolean;
}

const iconByName: Readonly<Record<ApplicationNavigationIcon, LucideIcon>> = {
  home: Home,
  library: LibraryBig,
  map: Map,
  pen: PenLine,
  profile: UserRound,
};

/** Responsive product frame that owns primary navigation and the main landmark. */
export function ApplicationShell({
  accountLabel,
  children,
  currentPath,
  desktopAccountSlot,
  mobileAccountSlot,
  mobileNavigationItems,
  navigationItems,
  sidebarDefaultPinned = false,
}: ApplicationShellProps) {
  return (
    <ShellFrame>
      <div className="flex min-h-svh items-start bg-white pb-28 text-[#202124] md:h-svh md:min-h-0 md:overflow-hidden md:pb-0">
        <Sidebar defaultPinned={sidebarDefaultPinned}>
          <SidebarBody>
            <SidebarContents
              accountLabel={accountLabel}
              accountSlot={desktopAccountSlot}
              currentPath={currentPath}
              items={navigationItems}
            />
          </SidebarBody>
        </Sidebar>
        <ShellMain>{children}</ShellMain>
      </div>
      <MobileBottomNavigation
        accountSlot={mobileAccountSlot}
        currentPath={currentPath}
        items={mobileNavigationItems ?? navigationItems}
      />
    </ShellFrame>
  );
}

function ShellFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-svh bg-white text-[#202124]" data-public-shell>
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
        "mobile-scrollbar-hidden min-h-svh min-w-0 flex-1 bg-white",
        "md:h-full md:min-h-0 md:overflow-x-hidden md:overflow-y-auto md:overscroll-y-contain md:[scrollbar-gutter:stable]",
      )}
      id="content"
      tabIndex={-1}
    >
      <div className="mx-auto w-full max-w-[66rem] px-4 pb-16 pt-5 sm:px-7 md:px-10 md:pb-20 md:pt-9">
        {children}
      </div>
    </main>
  );
}

interface NavigationProps {
  readonly accountLabel?: string | undefined;
  readonly accountSlot?: ReactNode | undefined;
  readonly currentPath: string;
  readonly items: readonly ApplicationNavigationItem[];
}

function SidebarContents({
  accountLabel,
  accountSlot,
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
        {accountSlot ?? <AccountPreview label={accountLabel ?? "Гость"} />}
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
  accountSlot,
  currentPath,
  items,
}: Pick<NavigationProps, "accountSlot" | "currentPath" | "items">) {
  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 rounded-[1.6rem] border border-black/8 bg-white/88 p-1.5 text-[#202124] shadow-[0_1.5rem_4rem_-1.25rem_rgb(20_21_24/0.6)] backdrop-blur-xl md:hidden"
    >
      <div
        className="flex items-center justify-center gap-1"
      >
        {items.map((item) => {
          const Icon = iconByName[item.icon];
          const current = isCurrentPath(currentPath, item.href);

          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-12 items-center justify-center gap-2 rounded-[1.15rem] px-3 text-xs font-semibold leading-none text-[#5f5e59] no-underline",
                "transition-[background,color,padding] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] active:bg-[#f3f1ed] focus-visible:outline-ring motion-reduce:transition-none",
                current && "bg-[#202124] px-5 text-white",
              )}
              href={item.href}
              key={item.href}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-5", current && "text-[#ef6b3c]")}
              />
              {current ? <span>{item.label}</span> : <span className="sr-only">{item.label}</span>}
            </Link>
          );
        })}
        {accountSlot}
      </div>
    </nav>
  );
}

/** Mobile wordmark shared by public pages inside ApplicationShell. */
export function PublicProductHeader() {
  return (
    <header className="md:hidden">
      <p className="text-lg font-extrabold tracking-[-0.035em]">
        Sachkov <span className="text-[#c7461e]">Inside</span>
      </p>
    </header>
  );
}

function isCurrentPath(pathname: string, href: Route): boolean {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
