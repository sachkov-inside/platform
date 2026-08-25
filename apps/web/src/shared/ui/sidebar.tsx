"use client";

import { Pin, PinOff } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/utils";

interface SidebarContextValue {
  readonly open: boolean;
  readonly pinned: boolean;
  readonly setPinned: (pinned: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);

  if (context === null) {
    throw new Error("useSidebar must be used within Sidebar");
  }

  return context;
}

interface SidebarProps {
  readonly children: ReactNode;
  readonly defaultPinned?: boolean;
}

export function Sidebar({ children, defaultPinned = false }: SidebarProps) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(defaultPinned);
  const open = pinned || hovered || focused;

  return (
    <SidebarContext.Provider value={{ open, pinned, setPinned }}>
      <div
        className="group/sidebar hidden h-svh shrink-0 bg-card md:block md:self-stretch md:py-3 md:pl-3"
        data-state={open ? "expanded" : "collapsed"}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
          }
        }}
        onFocusCapture={() => {
          setFocused(true);
        }}
        onMouseEnter={() => {
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

interface SidebarBodyProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function SidebarBody({ children, className }: SidebarBodyProps) {
  const { open } = useSidebar();

  return (
    <aside
      aria-label="Боковая панель"
      className={cn(
        "sticky top-3 flex h-[calc(100svh-1.5rem)] shrink-0 flex-col overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground transition-[width] duration-[var(--motion-duration-shell)] ease-[var(--motion-ease-out)] motion-reduce:transition-none",
        className,
      )}
      style={{ width: open ? "16rem" : "4.75rem" }}
    >
      {children}
    </aside>
  );
}

export function SidebarToggle({ className }: { readonly className?: string }) {
  const { open, pinned, setPinned } = useSidebar();

  return (
    <button
      aria-expanded={open}
      aria-label={pinned ? "Открепить сайдбар" : "Закрепить сайдбар"}
      aria-pressed={pinned}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md bg-transparent text-sidebar-foreground/38 transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none",
        "hover:text-sidebar-foreground focus-visible:outline-sidebar-ring",
        className,
      )}
      onClick={(event) => {
        const nextPinned = !pinned;

        setPinned(nextPinned);
        if (!nextPinned && event.detail > 0) {
          event.currentTarget.blur();
        }
      }}
      type="button"
    >
      {pinned ? <PinOff aria-hidden="true" className="size-4" /> : <Pin aria-hidden="true" className="size-4" />}
    </button>
  );
}

interface SidebarLinkProps {
  readonly current?: boolean;
  readonly href: Route;
  readonly icon: ReactNode;
  readonly label: string;
}

export function SidebarLink({ current = false, href, icon, label }: SidebarLinkProps) {
  const { open } = useSidebar();

  return (
    <Link
      aria-current={current ? "page" : undefined}
      aria-label={open ? undefined : label}
      className={cn(
        "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground/72 no-underline transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-sidebar-ring",
        current && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
      href={href}
      onClick={(event) => {
        if (event.detail > 0) {
          event.currentTarget.blur();
        }
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5 shrink-0 place-items-center transition-colors [&_svg]:size-5",
          current && "text-sidebar-primary",
        )}
      >
        {icon}
      </span>
      <span className="md:hidden">{label}</span>
      <span
        aria-hidden={!open}
        className={cn(
          "hidden whitespace-nowrap transition-[opacity,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none md:inline",
          open ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
        )}
      >
        {label}
      </span>
      {current ? (
        <span
          aria-hidden="true"
          className="ml-auto hidden size-1.5 rounded-full bg-sidebar-primary md:block"
        />
      ) : null}
    </Link>
  );
}
