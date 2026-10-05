"use client";

import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";

import { ReadingProgressProvider } from "@/features/reading-progress";
import { useAuthStatus } from "./auth-status-control.client";
import { PublicApplicationFrame } from "./public-application-frame.client";
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
  const readingProviderKey = useReadingProviderKey(
    authStatus.accountId,
    authStatus.resolved,
  );

  return (
    <PublicApplicationFrame
      authResolved={authStatus.resolved}
      authState={authStatus.state}
      canManageMaterials={authStatus.canManageMaterials}
      currentPath={mobileNavigation.pendingHref?.split("?")[0] ?? pathname}
      homeHref={mobileNavigation.homeHref}
      onMobileNavigate={mobileNavigation.onNavigate}
    >
      <Suspense fallback={null}>
        <MobileNavigationLocation onChange={mobileNavigation.recordLocation} />
        <NavigationTiming />
      </Suspense>
      <ReadingProgressProvider
        key={readingProviderKey}
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
    </PublicApplicationFrame>
  );
}

/**
 * Прогресс чтения принадлежит аккаунту, поэтому при смене аккаунта провайдер создаётся заново. Первый
 * ответ о входе аккаунт не меняет: до него личного на странице нет, а новый ключ пересоздал бы
 * страницу, уже нарисованную сервером (#747).
 */
function useReadingProviderKey(
  accountId: string | null,
  resolved: boolean,
): string {
  // Объект отличает «первого ответа ещё не было» от «первым ответил гость».
  const [first, setFirst] = useState<{ readonly accountId: string | null }>();
  if (resolved && first === undefined) setFirst({ accountId });
  const firstAccountId = first === undefined ? accountId : first.accountId;
  return !resolved || accountId === firstAccountId
    ? "first-account"
    : (accountId ?? "guest");
}
