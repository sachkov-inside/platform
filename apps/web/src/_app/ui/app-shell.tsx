"use client";

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  ApplicationShell,
  navigationItemsFor,
  publicMobileNavigationItems,
} from "@/widgets/application-shell";
import { HeaderAuthControl, TelegramReminder } from "@/widgets/auth-control";
import {
  accountPresentationBrowserQueryOptions,
  AccountTelegramOnboarding,
  openTelegramOnboarding,
} from "@/features/account-access";
import { ReadingProgressProvider } from "@/features/reading-progress";
import { LibrarySeriesStateProvider } from "@/_pages/library";
import { useAuthStatus } from "./auth-status-control.client";
import { PublicNavigationPending } from "./public-navigation-pending";
import { MobileNavigationLocation } from "./mobile-navigation-location.client";
import { useMobileNavigation } from "./use-mobile-navigation.client";

interface AppShellProps {
  readonly children: ReactNode;
}

/** Connects the accepted application shell to App Router route state. */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const authStatus = useAuthStatus();
  const mobileNavigation = useMobileNavigation(pathname, authStatus.accountId, authStatus.resolved && authStatus.state !== "unavailable");
  const navigationItems = navigationItemsFor({
    canManageMaterials: authStatus.canManageMaterials,
  });
  const presentation = useQuery({
    ...accountPresentationBrowserQueryOptions(),
    enabled: authStatus.resolved && authStatus.state === "authenticated",
  });
  // Пока Telegram не подключён, напоминание висит в оболочке, а не только в кабинете.
  const telegramPending =
    presentation.data?.kind === "ready" &&
    presentation.data.presentation.telegramMembership.link.kind !== "linked";

  return (
    <ApplicationShell
      currentPath={mobileNavigation.pendingHref?.split("?")[0] ?? pathname}
      accountSlot={
        <div className="flex items-center gap-1">
          {telegramPending ? (
            <TelegramReminder onOpen={openTelegramOnboarding} />
          ) : null}
          <HeaderAuthControl state={authStatus.state} />
        </div>
      }
      navigationItems={navigationItems}
      mobileNavigationItems={publicMobileNavigationItems.map((item) =>
        item.href === "/library"
          ? { ...item, href: mobileNavigation.libraryHref }
          : item.href === "/account" && telegramPending
            ? { ...item, badge: true }
            : item,
      )}
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
