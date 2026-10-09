"use client";

import type { Route } from "next";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { isProductCapability } from "@/entities/subscription";
import { useCurrentBilling } from "@/features/billing-subscription";
import {
  ApplicationShell,
  mobileNavigationItemsFor,
  navigationItemsFor,
} from "@/widgets/application-shell";
import {
  type AuthControlState,
  HeaderAuthControl,
  TelegramReminder,
} from "@/widgets/auth-control";
import {
  accountPresentationBrowserQueryOptions,
  AccountTelegramOnboarding,
  openTelegramOnboarding,
} from "@/features/account-access";

export interface PublicApplicationFrameProps {
  readonly authState: AuthControlState;
  readonly authResolved: boolean;
  readonly canManageMaterials: boolean;
  /** Адрес, который навигация отмечает текущим. */
  readonly currentPath: string;
  /** Куда ведёт «Главная» мобильной навигации: оболочка помнит последний адрес вкладки. */
  readonly homeHref?: Route;
  readonly onMobileNavigate?: (href: Route) => void;
  readonly children: ReactNode;
}

/**
 * Состав публичной оболочки при известном статусе входа: шапка с напоминанием о Telegram и
 * контролом аккаунта, навигация по правам, окно подключения Telegram. Его надевает `AppShell` на
 * маршруте и окружение Storybook, поэтому каталог показывает ту же оболочку.
 */
export function PublicApplicationFrame({
  authState,
  authResolved,
  canManageMaterials,
  currentPath,
  homeHref = "/",
  onMobileNavigate,
  children,
}: PublicApplicationFrameProps) {
  const signedIn = authResolved && authState === "authenticated";
  // «Курс» в навигации видит тот, кому открыт продукт: основания доступа читает браузер вошедшего.
  const billing = useCurrentBilling({ enabled: signedIn });
  const hasCourse =
    signedIn &&
    billing.data?.ok === true &&
    billing.data.value.grounds.some(
      (ground) =>
        ground.active && ground.capabilities.some(isProductCapability),
    );
  const navigationItems = navigationItemsFor({ canManageMaterials, hasCourse });
  const presentation = useQuery({
    ...accountPresentationBrowserQueryOptions(),
    enabled: authResolved && authState === "authenticated",
  });
  // Пока Telegram не подключён, напоминание висит в оболочке, а не только в кабинете.
  const telegramPending =
    presentation.data?.kind === "ready" &&
    presentation.data.presentation.telegramMembership.link.kind !== "linked";

  return (
    <ApplicationShell
      currentPath={currentPath}
      accountSlot={
        <div className="flex items-center gap-1">
          {telegramPending ? (
            <TelegramReminder onOpen={openTelegramOnboarding} />
          ) : null}
          <HeaderAuthControl state={authState} />
        </div>
      }
      navigationItems={navigationItems}
      mobileNavigationItems={mobileNavigationItemsFor({ hasCourse }).map(
        (item) =>
          item.href === "/"
            ? { ...item, href: homeHref }
            : item.href === "/account" && telegramPending
              ? { ...item, badge: true }
              : item,
      )}
      {...(onMobileNavigate === undefined ? {} : { onMobileNavigate })}
    >
      {children}
      <AccountTelegramOnboarding
        authenticated={authState === "authenticated"}
        authResolved={authResolved}
      />
    </ApplicationShell>
  );
}
