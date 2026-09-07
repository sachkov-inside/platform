"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import { HeaderAuthControl } from "@/widgets/auth-control";
import { AccountTelegramOnboarding } from "@/features/account-access";
import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import { ReadingProgressProvider } from "@/features/reading-progress";
import { useAuthStatus } from "./auth-status-control.client";
import { useMobileNavigation } from "./use-mobile-navigation.client";

interface AppShellProps {
  readonly children: ReactNode;
}

const publicNavigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
] satisfies readonly ApplicationNavigationItem[];

const mobileNavigationItems = [
  ...publicNavigationItems,
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
  const mobileNavigation = useMobileNavigation(pathname, authStatus.accountId, authStatus.resolved && authStatus.state !== "unavailable");
  const navigationItems = authStatus.canManageMaterials
    ? [...publicNavigationItems, authoringNavigationItem]
    : publicNavigationItems;

  return (
    <ApplicationShell
      currentPath={pathname}
      accountSlot={<HeaderAuthControl state={authStatus.state} />}
      navigationItems={navigationItems}
      mobileNavigationItems={mobileNavigationItems.map((item) => item.href === "/library" ? { ...item, href: mobileNavigation.libraryHref } : item)}
      onMobileNavigate={mobileNavigation.onNavigate}
    >
      <ReadingProgressProvider key={authStatus.accountId ?? "guest"} accountId={authStatus.accountId} resolved={authStatus.resolved}>
        {children}
      </ReadingProgressProvider>
      <AccountTelegramOnboarding
        authenticated={authStatus.state === "authenticated"}
        authResolved={authStatus.resolved}
      />
    </ApplicationShell>
  );
}
