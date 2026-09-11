import type { Decorator } from "@storybook/react-vite";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
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

/** Рамка страницы: продакшен-модуль, задающий кадр и прокрутку своего маршрута. */
type PageFrame = ComponentType<{ readonly children: ReactNode }>;

/**
 * Окружение story: адрес маршрута, декораторы оболочки и параметры кадра. Story раскрывает его
 * первым ключом `meta`, а собственные декораторы ставит перед `...environment.decorators`.
 */
interface StoryEnvironment {
  readonly beforeEach: () => void;
  readonly decorators: Decorator[];
  readonly parameters: Record<string, unknown>;
}

/** Декораторы применяются изнутри наружу: первый ближе к story, последний — внешняя оболочка. */
function frameDecorator(Frame: PageFrame): Decorator {
  return (Story) => (
    <Frame>
      <Story />
    </Frame>
  );
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

/** Публичная оболочка приложения с её настоящей навигацией и слотом аккаунта. */
export function PublicShellFrame({
  account = "guest",
  children,
  currentPath,
}: {
  readonly account?: AccountState;
  readonly children: ReactNode;
  readonly currentPath: string;
}) {
  return (
    <ApplicationShell
      accountSlot={<HeaderAuthControl state={account} />}
      currentPath={currentPath}
      mobileNavigationItems={publicMobileNavigationItems}
      navigationItems={publicNavigationItems}
    >
      {children}
    </ApplicationShell>
  );
}

/**
 * Публичная страница в своей оболочке. Шапка, навигация, отступы и прокрутка те же, что на
 * маршруте: до 48rem прокручивается документ, с 48rem — `#content` оболочки. `frame` добавляет
 * рамку самой страницы, когда story показывает её отдельный раздел.
 */
export function publicPageEnvironment(
  currentPath: string,
  {
    account = "guest",
    frame,
  }: { readonly account?: AccountState; readonly frame?: PageFrame } = {},
): StoryEnvironment {
  return routeEnvironment(currentPath, [
    ...(frame === undefined ? [] : [frameDecorator(frame)]),
    (Story) => (
      <PublicShellFrame account={account} currentPath={currentPath}>
        <Story />
      </PublicShellFrame>
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

/** Рамка личного кабинета: разделы слева, один раздел справа — как в `account/layout.tsx`. */
function AccountCabinetFrame({ children }: { readonly children: ReactNode }) {
  return (
    <AccountCabinet options={publicSubscriptionOffers(billingOffers)}>{children}</AccountCabinet>
  );
}

/**
 * Раздел личного кабинета: публичная оболочка снаружи, рамка разделов внутри — ровно тот порядок,
 * который даёт `app/(public)/layout.tsx` вместе с `app/(public)/account/layout.tsx`.
 */
export function accountSectionEnvironment(currentPath: string): StoryEnvironment {
  return publicPageEnvironment(currentPath, {
    account: "authenticated",
    frame: AccountCabinetFrame,
  });
}

/**
 * Авторская оболочка: тот же боковой список и мобильная нижняя навигация, что и в `/authoring`.
 * `frame` добавляет рамку самой страницы, когда story показывает её отдельный раздел.
 */
export function authoringPageEnvironment(
  currentPath: string,
  frame?: PageFrame,
): StoryEnvironment {
  return routeEnvironment(currentPath, [
    ...(frame === undefined ? [] : [frameDecorator(frame)]),
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
