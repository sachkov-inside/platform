"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import { AuthStatusControl } from "./auth-status-control.client";

interface AppShellProps {
  readonly children: ReactNode;
}

const navigationItems = [
  { href: "/library", icon: "library", label: "База знаний" },
] satisfies readonly ApplicationNavigationItem[];

/** Connects the accepted application shell to App Router route state. */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <ApplicationShell
      accountLabel="Гость"
      currentPath={pathname}
      desktopAccountSlot={<AuthStatusControl presentation="desktop" />}
      mobileAccountSlot={<AuthStatusControl presentation="mobile" />}
      navigationItems={navigationItems}
    >
      {children}
    </ApplicationShell>
  );
}
