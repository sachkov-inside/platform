"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import { DesktopAuthControl } from "@/widgets/auth-control";
import { AccountTelegramOnboarding } from "@/features/account-access";
import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import { useAuthStatus } from "./auth-status-control.client";

interface AppShellProps {
  readonly children: ReactNode;
}

const publicNavigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
] satisfies readonly ApplicationNavigationItem[];

const mobileNavigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
  { href: "/account", icon: "profile", label: "Профиль" },
] satisfies readonly ApplicationNavigationItem[];

const authoringNavigationItem = {
  href: authoringMaterialsRootHref,
  icon: "pen",
  label: "Редактор",
} as const satisfies ApplicationNavigationItem;

/** Connects the accepted application shell to App Router route state. */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const authStatus = useAuthStatus();
  const navigationItems = authStatus.canManageMaterials
    ? [...publicNavigationItems, authoringNavigationItem]
    : publicNavigationItems;

  return (
    <ApplicationShell
      accountLabel="Гость"
      currentPath={pathname}
      desktopAccountSlot={<DesktopAuthControl state={authStatus.state} />}
      mobileNavigationItems={mobileNavigationItems}
      navigationItems={navigationItems}
    >
      {children}
      <AccountTelegramOnboarding
        authenticated={authStatus.state === "authenticated"}
        authResolved={authStatus.resolved}
      />
    </ApplicationShell>
  );
}
