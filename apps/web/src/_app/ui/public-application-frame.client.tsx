"use client";

import { ProfileAvatar } from "@/entities/member-profile";
import type { Route } from "next";
import type { ReactNode } from "react";

import {
  ApplicationShell,
  publicMobileNavigationItems,
  navigationItemsFor,
} from "@/widgets/application-shell";
import {
  type AuthControlState,
  HeaderAuthControl,
} from "@/widgets/auth-control";
import {
  useAccountPresentation,
  AccountTelegramNotice,
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
 * контролом аккаунта и навигация по правам. Его надевает `AppShell` на
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
  const navigationItems = navigationItemsFor({ canManageMaterials });
  const presentation = useAccountPresentation({
    enabled: authResolved && authState === "authenticated",
  });
  // Пока Telegram не подключён, напоминание висит в оболочке, а не только в кабинете.
  const telegramPending =
    authResolved &&
    authState === "authenticated" &&
    presentation.data?.kind === "ready" &&
    presentation.data.presentation.telegramMembership.link.kind !== "linked";

  const profile =
    presentation.data?.kind === "ready" &&
    presentation.data.presentation.profile.kind === "profile"
      ? presentation.data.presentation.profile.profile
      : null;
  return (
    <ApplicationShell
      currentPath={currentPath}
      accountSlot={
        <div className="flex items-center gap-2 sm:gap-3">
          {telegramPending ? (
            <AccountTelegramNotice
              onRefresh={() => presentation.refetch().then(() => undefined)}
            />
          ) : null}
          <HeaderAuthControl
            state={authState}
            avatar={
              <ProfileAvatar
                avatar={profile?.avatar ?? null}
                displayName={profile?.displayName ?? ""}
                size="header"
                fallback="icon"
              />
            }
          />
        </div>
      }
      navigationItems={navigationItems}
      mobileNavigationItems={publicMobileNavigationItems.map((item) =>
        item.href === "/" ? { ...item, href: homeHref } : item,
      )}
      {...(onMobileNavigate === undefined ? {} : { onMobileNavigate })}
    >
      {children}
    </ApplicationShell>
  );
}
