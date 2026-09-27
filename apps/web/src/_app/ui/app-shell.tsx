"use client";

import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
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
import { useAuthStatus } from "./auth-status-control.client";
import { PublicNavigationPending } from "./public-navigation-pending";
import { MobileNavigationLocation } from "./mobile-navigation-location.client";
import { NavigationTiming } from "./navigation-timing.client";
import { useAccessChangeRefresh } from "./use-access-change-refresh.client";
import { useMobileNavigation } from "./use-mobile-navigation.client";

interface AppShellProps {
  readonly children: ReactNode;
}

/** Connects the accepted application shell to App Router route state. */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const authStatus = useAuthStatus();
  const accountKnown =
    authStatus.resolved && authStatus.state !== "unavailable";
  const mobileNavigation = useMobileNavigation(
    pathname,
    authStatus.accountId,
    accountKnown,
  );
  useAccessChangeRefresh(authStatus.accountId, accountKnown);
  const readingScope = useReadingScope(
    authStatus.accountId,
    authStatus.resolved,
  );
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
        item.href === "/"
          ? { ...item, href: mobileNavigation.homeHref }
          : item.href === "/account" && telegramPending
            ? { ...item, badge: true }
            : item,
      )}
      onMobileNavigate={mobileNavigation.onNavigate}
    >
      <Suspense fallback={null}>
        <MobileNavigationLocation onChange={mobileNavigation.recordLocation} />
        <NavigationTiming />
      </Suspense>
      <ReadingProgressProvider
        key={readingScope}
        accountId={authStatus.accountId}
        resolved={authStatus.resolved}
      >
        <div
          aria-hidden={mobileNavigation.pendingHref !== null || undefined}
          inert={mobileNavigation.pendingHref !== null}
          className={
            mobileNavigation.pendingHref !== null ? "invisible" : undefined
          }
        >
          {children}
        </div>
        {mobileNavigation.pendingHref !== null ? (
          <PublicNavigationPending href={mobileNavigation.pendingHref} />
        ) : null}
      </ReadingProgressProvider>
      <AccountTelegramOnboarding
        authenticated={authStatus.state === "authenticated"}
        authResolved={authStatus.resolved}
      />
    </ApplicationShell>
  );
}

/**
 * Прогресс чтения принадлежит аккаунту, поэтому при смене аккаунта провайдер создаётся заново. Первый
 * ответ о входе аккаунт не меняет: до него личного на странице нет, а новый ключ пересоздал бы
 * страницу, уже нарисованную сервером (#747).
 */
function useReadingScope(accountId: string | null, resolved: boolean): string {
  const [first, setFirst] = useState<{ readonly accountId: string | null }>();
  if (resolved && first === undefined) setFirst({ accountId });
  return !resolved || accountId === (first ?? { accountId }).accountId
    ? "first-account"
    : (accountId ?? "guest");
}
