import type { Decorator } from "@storybook/react-vite";
import { usePathname } from "next/navigation";
import { mocked, within } from "storybook/test";

import { publicSubscriptionOffers } from "@/entities/subscription";
import { AccountCabinet } from "@/widgets/account-cabinet";
import {
  ApplicationShell,
  publicMobileNavigationItems,
  publicNavigationItems,
} from "@/widgets/application-shell";
import { HeaderAuthControl } from "@/widgets/auth-control";
import { AuthoringShell } from "@/widgets/authoring-shell";

import { billingOffers } from "./billing.fixtures";

/** Состояние аккаунта в шапке; на маршруте его подставляет адаптер приложения. */
type AccountState = "authenticated" | "guest" | "unavailable";

/**
 * Окружение story: адрес маршрута, декораторы оболочки и параметры кадра. Story раскрывает его
 * первым ключом `meta`, а собственные декораторы ставит перед `...environment.decorators`.
 */
interface StoryEnvironment {
  readonly beforeEach: () => void;
  readonly decorators: Decorator[];
  readonly parameters: Record<string, unknown>;
}

function routeEnvironment(currentPath: string, decorators: Decorator[]): StoryEnvironment {
  return {
    beforeEach: () => {
      mocked(usePathname).mockReturnValue(currentPath);
    },
    decorators,
    parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  };
}

/**
 * Публичная страница в своей оболочке. Шапка, навигация, отступы и прокрутка те же, что на
 * маршруте: до 48rem прокручивается документ, с 48rem — `#content` оболочки.
 */
export function publicPageEnvironment(
  currentPath: string,
  account: AccountState = "guest",
): StoryEnvironment {
  return routeEnvironment(currentPath, [
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
  ]);
}

/** Слот аккаунта в настоящей шапке: контрол показан там же, где его видит участник. */
export function publicHeaderEnvironment(currentPath = "/"): StoryEnvironment {
  return routeEnvironment(currentPath, [
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
  ]);
}

/**
 * Раздел личного кабинета: публичная оболочка плюс рамка разделов — ровно то, что даёт
 * `app/(public)/account/layout.tsx` вокруг любой страницы `/account/*`.
 */
export function accountSectionEnvironment(currentPath: string): StoryEnvironment {
  const shell = publicPageEnvironment(currentPath, "authenticated");
  return {
    ...shell,
    decorators: [
      ...shell.decorators,
      (Story) => (
        <AccountCabinet options={publicSubscriptionOffers(billingOffers)}>
          <Story />
        </AccountCabinet>
      ),
    ],
  };
}

/** Авторская оболочка: тот же боковой список и мобильная нижняя навигация, что и в `/authoring`. */
export function authoringPageEnvironment(currentPath: string): StoryEnvironment {
  return routeEnvironment(currentPath, [
    (Story) => (
      <AuthoringShell>
        <Story />
      </AuthoringShell>
    ),
  ]);
}

/**
 * Содержимое маршрута внутри его оболочки. Оболочка остаётся вокруг story, как в приложении,
 * поэтому утверждения о самой странице ищут в её `main`, а не в навигации оболочки.
 */
export function routeContent(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole("main"));
}
