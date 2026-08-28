"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";

interface AppShellProps {
  readonly children: ReactNode;
  readonly desktopAccountSlot?: ReactNode | undefined;
  readonly mobileAccountSlot?: ReactNode | undefined;
}

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

/** Connects the accepted application shell to App Router route state. */
export function AppShell({ children, desktopAccountSlot, mobileAccountSlot }: AppShellProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/authoring/")) {
    return children;
  }

  return (
    <ApplicationShell
      accountLabel="Гость"
      currentPath={pathname}
      desktopAccountSlot={desktopAccountSlot}
      mobileAccountSlot={mobileAccountSlot}
      navigationItems={navigationItems}
    >
      {children}
    </ApplicationShell>
  );
}
