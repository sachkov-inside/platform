"use client";

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import { HeaderAuthControl } from "@/widgets/auth-control";
import { AccountTelegramOnboarding } from "@/features/account-access";
import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import { ReadingProgressProvider } from "@/features/reading-progress";
import { LibrarySeriesStateProvider } from "@/_pages/library";
import { useAuthStatus } from "./auth-status-control.client";
import { PublicNavigationPending } from "./public-navigation-pending";
import { MobileNavigationLocation } from "./mobile-navigation-location.client";
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
      currentPath={mobileNavigation.pendingHref?.split("?")[0] ?? pathname}
      accountSlot={<HeaderAuthControl state={authStatus.state} />}
      navigationItems={navigationItems}
      mobileNavigationItems={mobileNavigationItems.map((item) => item.href === "/library" ? { ...item, href: mobileNavigation.libraryHref } : item)}
      onMobileNavigate={mobileNavigation.onNavigate}
    >
      <Suspense fallback={null}>
        <MobileNavigationLocation onChange={mobileNavigation.recordLocation} />
      </Suspense>
      <ReadingProgressProvider key={authStatus.accountId ?? "guest"} accountId={authStatus.accountId} resolved={authStatus.resolved}>
        <LibrarySeriesStateProvider>
        <div aria-hidden={mobileNavigation.pendingHref !== null || undefined} inert={mobileNavigation.pendingHref !== null} className={mobileNavigation.pendingHref !== null ? "invisible" : undefined}>
          {children}
        </div>
        {mobileNavigation.pendingHref !== null ? <PublicNavigationPending href={mobileNavigation.pendingHref} /> : null}
        </LibrarySeriesStateProvider>
      </ReadingProgressProvider>
      <AccountTelegramOnboarding
        authenticated={authStatus.state === "authenticated"}
        authResolved={authStatus.resolved}
      />
    </ApplicationShell>
  );
}
