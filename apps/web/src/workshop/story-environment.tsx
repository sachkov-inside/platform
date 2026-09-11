import type { Decorator } from "@storybook/react-vite";
import { usePathname } from "next/navigation";
import { mocked, within } from "storybook/test";

import { publicSubscriptionOffers, type PriceSnapshot } from "@/entities/subscription";
import { AccountCabinet } from "@/widgets/account-cabinet";
import {
  ApplicationShell,
  publicMobileNavigationItems,
  publicNavigationItems,
} from "@/widgets/application-shell";
import { HeaderAuthControl } from "@/widgets/auth-control";
import { AuthoringShell } from "@/widgets/authoring-shell";

import { billingOffers } from "./billing.fixtures";

/**
 * Продакшен-окружение для story. Страница в каталоге живёт в той же оболочке, что и её маршрут,
 * поэтому шапка, навигация, отступы и прокрутка совпадают с приложением: до 48rem прокручивается
 * документ, с 48rem — `#content` публичной оболочки или собственный `main` авторской.
 */
export function publicPageEnvironment(
  currentPath: string,
  account: "authenticated" | "guest" | "unavailable" = "guest",
) {
  return {
    decorators: [
      (Story) => (
        <ApplicationShell
          accountSlot={<HeaderAuthControl state={account} />}
          currentPath={currentPath}
          mobileNavigationItems={publicMobileNavigationItems}
          navigationItems={publicNavigationItems}
        >
          <Story />
        </ApplicationShell>
      ),
    ] satisfies readonly Decorator[],
    parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  };
}

/** Слот аккаунта в настоящей шапке: контрол показан там же, где его видит участник. */
export function publicHeaderEnvironment(currentPath = "/") {
  return {
    decorators: [
      (Story) => (
        <ApplicationShell
          accountSlot={<Story />}
          currentPath={currentPath}
          mobileNavigationItems={publicMobileNavigationItems}
          navigationItems={publicNavigationItems}
        >
          {null}
        </ApplicationShell>
      ),
    ] satisfies readonly Decorator[],
    parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  };
}

/**
 * Публичная оболочка плюс рамка личного кабинета: разделы слева, один раздел справа — ровно то,
 * что даёт `app/(public)/account/layout.tsx`.
 */
export function accountSectionEnvironment(
  currentPath: string,
  options: readonly PriceSnapshot[] = publicSubscriptionOffers(billingOffers),
) {
  const shell = publicPageEnvironment(currentPath, "authenticated");
  return {
    beforeEach: () => {
      mocked(usePathname).mockReturnValue(currentPath);
    },
    decorators: [
      ...shell.decorators,
      ((Story) => (
        <AccountCabinet options={options}>
          <Story />
        </AccountCabinet>
      )) satisfies Decorator,
    ],
    parameters: shell.parameters,
  };
}

/** Авторская оболочка: тот же боковой список и мобильная нижняя навигация, что и в `/authoring`. */
export function authoringPageEnvironment(currentPath: string) {
  return {
    beforeEach: () => {
      mocked(usePathname).mockReturnValue(currentPath);
    },
    decorators: [
      (Story) => (
        <AuthoringShell>
          <Story />
        </AuthoringShell>
      ),
    ] satisfies readonly Decorator[],
    parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  };
}

/**
 * Содержимое маршрута внутри его оболочки. Оболочка остаётся вокруг story, как в приложении,
 * поэтому утверждения о самой странице ищут в её `main`, а не в навигации оболочки.
 */
export function routeContent(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole("main"));
}
