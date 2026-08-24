"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";

interface AppShellProps {
  readonly children: ReactNode;
}

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

/** Connects the accepted application shell to App Router route state. */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <ApplicationShell
      accountLabel="Гость"
      currentPath={pathname}
      navigationItems={navigationItems}
    >
      {children}
    </ApplicationShell>
  );
}
