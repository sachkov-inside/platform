import type { Decorator } from "@storybook/react-vite";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { mocked, within } from "storybook/test";

import { currentLegalEdition } from "@inside/legal";

import { PublicApplicationFrame } from "@/_app/ui/public-application-frame.client";
import { PublicShellContent } from "@/_app/ui/public-shell-content";
import {
  type PriceSnapshot,
  publicSubscriptionOffers,
} from "@/entities/subscription";
import { telegramOnboardingDismissalKey } from "@/features/account-access";
import { storageNoticeKey } from "@/features/storage-notice";
import { getQueryClient } from "@/shared/api/query-client";
import { AccountCabinet } from "@/widgets/account-cabinet";
import {
  ApplicationShell,
  publicMobileNavigationItems,
  publicNavigationItems,
} from "@/widgets/application-shell";
import { AuthoringShell } from "@/widgets/authoring-shell";

import { billingOffers } from "./billing.fixtures";
import { fetchBeforeRender, type MutationFetch } from "./mutation-mock";

/**
 * Статус входа, который на маршруте приносит `/auth/status`. `author` — участник, который ведёт
 * материалы: шапка показывает ему «Редактор».
 */
type AccountState = "authenticated" | "author" | "guest" | "unavailable";

/**
 * Состояние браузера, от которого зависят части оболочки. По умолчанию это вернувшийся участник:
 * уведомление о хранении уже принято, а окно подключения Telegram закрыто в этой сессии. Тогда
 * участник без Telegram видит напоминание в шапке и точку у «Профиля», как на маршруте.
 */
interface ShellBrowserState {
  /** `first-visit` — первое посещение: внизу висит уведомление о хранении. */
  readonly storageNotice?: "acknowledged" | "first-visit";
  /** `shown` — окно подключения Telegram открывается само, как сразу после входа. */
  readonly telegramOnboarding?: "dismissed" | "shown";
}

/** Рамка страницы: продакшен-модуль, задающий кадр и прокрутку своего маршрута. */
type PageFrame = ComponentType<{ readonly children: ReactNode }>;

/**
 * Окружение story: адрес маршрута, декораторы оболочки и параметры кадра. Story раскрывает его
 * первым ключом `meta`, а собственные декораторы ставит перед `...environment.decorators`.
 */
interface StoryEnvironment {
  /** Возвращает снятие подмены, когда окружение подменяет ответы BFF. */
  readonly beforeEach: () => (() => void) | undefined;
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

/** Хранилище браузера ставится до первого рендера: оболочка читает его синхронно. */
function prepareShellBrowserState({
  storageNotice = "acknowledged",
  telegramOnboarding = "dismissed",
}: ShellBrowserState): void {
  if (storageNotice === "acknowledged")
    window.localStorage.setItem(
      storageNoticeKey,
      String(currentLegalEdition("cookies").version),
    );
  else window.localStorage.removeItem(storageNoticeKey);
  if (telegramOnboarding === "dismissed")
    window.sessionStorage.setItem(telegramOnboardingDismissalKey, "true");
  else window.sessionStorage.removeItem(telegramOnboardingDismissalKey);
}

function routeEnvironment(
  currentPath: string,
  decorators: Decorator[],
  browserState: ShellBrowserState = {},
): StoryEnvironment {
  return {
    beforeEach: () => {
      mocked(usePathname).mockReturnValue(currentPath);
      prepareShellBrowserState(browserState);
    },
    decorators,
    parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  };
}

/**
 * Публичная оболочка приложения: тот же состав, что надевает `PublicShell` на маршруте, — шапка с
 * напоминанием о Telegram, навигация по правам, окно подключения Telegram, сообщение о входе и
 * уведомление о хранении. Статус входа известен сразу: его подставляет story, а не `/auth/status`.
 */
export function PublicShellFrame({
  account = "guest",
  accountSlot,
  children,
  currentPath,
}: {
  readonly account?: AccountState;
  /**
   * Story самого контрола аккаунта: он встаёт в слот настоящей шапки вместо контрола оболочки.
   * Остальной состав оболочки в таком кадре не нужен.
   */
  readonly accountSlot?: ReactNode;
  readonly children: ReactNode;
  readonly currentPath: string;
}) {
  if (accountSlot !== undefined)
    return (
      <ApplicationShell
        accountSlot={accountSlot}
        currentPath={currentPath}
        mobileNavigationItems={publicMobileNavigationItems}
        navigationItems={publicNavigationItems}
      >
        {children}
      </ApplicationShell>
    );
  return (
    <PublicApplicationFrame
      authResolved
      authState={account === "author" ? "authenticated" : account}
      canManageMaterials={account === "author"}
      currentPath={currentPath}
    >
      <PublicShellContent>{children}</PublicShellContent>
    </PublicApplicationFrame>
  );
}

const accountStates: readonly AccountState[] = [
  "author",
  "authenticated",
  "guest",
  "unavailable",
];

function storyAccount(parameters: Record<string, unknown>) {
  const value = parameters["account"];
  return accountStates.find((state) => state === value);
}

/**
 * Публичная страница в своей оболочке. Шапка, навигация, отступы и прокрутка те же, что на
 * маршруте: до 48rem прокручивается документ, с 48rem — `[data-application-content]` оболочки. `frame` добавляет
 * рамку самой страницы, когда story показывает её отдельный раздел. Отдельная история меняет
 * состояние аккаунта в шапке через `parameters.account`, когда её данные относятся к вошедшему.
 */
export function publicPageEnvironment(
  currentPath: string,
  {
    account = "guest",
    frame,
    ...browserState
  }: {
    readonly account?: AccountState;
    readonly frame?: PageFrame;
  } & ShellBrowserState = {},
): StoryEnvironment {
  return routeEnvironment(
    currentPath,
    [
      ...(frame === undefined ? [] : [frameDecorator(frame)]),
      (Story, context) => (
        <PublicShellFrame
          account={storyAccount(context.parameters) ?? account}
          currentPath={currentPath}
        >
          <Story />
        </PublicShellFrame>
      ),
    ],
    browserState,
  );
}

/** Слот аккаунта в настоящей шапке: контрол показан там же, где его видит участник. */
export function publicHeaderEnvironment(currentPath = "/"): StoryEnvironment {
  return routeEnvironment(currentPath, [
    (Story) => (
      <PublicShellFrame accountSlot={<Story />} currentPath={currentPath}>
        {null}
      </PublicShellFrame>
    ),
  ]);
}

/**
 * Рамка личного кабинета: разделы слева, один раздел справа — как в `account/layout.tsx`. Каталог
 * вариантов подписки на маршруте читает сервер; здесь его подставляет story.
 */
function accountSectionFrame(offers: readonly PriceSnapshot[]): PageFrame {
  return function AccountSectionFrame({ children }) {
    return (
      <AccountCabinet options={publicSubscriptionOffers(offers)}>
        {children}
      </AccountCabinet>
    );
  };
}

/**
 * Раздел личного кабинета: публичная оболочка снаружи, рамка разделов внутри — ровно тот порядок,
 * который даёт `app/(public)/layout.tsx` вместе с `app/(public)/account/layout.tsx`. Кабинет
 * открывается заново, как при переходе по адресу: ответы прошлой story в кеше запросов не остаются.
 * `subscriptionOffers` — каталог вариантов подписки; пустой каталог значит, что подписку не продают.
 * `fetch` отвечает на чтения оболочки, рамки и раздела до первого рендера, как BFF на маршруте; он
 * создаётся заново на каждый показ, поэтому записи одной story не переходят в следующую.
 */
export function accountSectionEnvironment(
  currentPath: string,
  {
    account = "authenticated",
    fetch,
    subscriptionOffers = billingOffers,
    ...browserState
  }: {
    readonly account?: AccountState;
    readonly fetch?: () => MutationFetch;
    readonly subscriptionOffers?: readonly PriceSnapshot[];
  } & ShellBrowserState = {},
): StoryEnvironment {
  const environment = publicPageEnvironment(currentPath, {
    account,
    frame: accountSectionFrame(subscriptionOffers),
    ...browserState,
  });
  return {
    ...environment,
    beforeEach: () => {
      getQueryClient().clear();
      environment.beforeEach();
      return fetch === undefined ? undefined : fetchBeforeRender(fetch())();
    },
  };
}

/**
 * Авторская оболочка: тот же боковой список и мобильная нижняя навигация, что и в `/authoring`.
 * `frame` добавляет рамку самой страницы, когда story показывает её отдельный раздел.
 */
export function authoringPageEnvironment(
  currentPath: string,
  { frame }: { readonly frame?: PageFrame } = {},
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
