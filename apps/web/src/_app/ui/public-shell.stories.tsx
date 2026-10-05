import { currentLegalEdition, parseLegalText } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LegalDocumentPage } from "@/_pages/legal";
import { PageNotFound } from "@/_pages/route-states";
import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import {
  accountPresentationResponse,
  respondByPath,
} from "@/storybook/account.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

const terms = currentLegalEdition("terms");

/** Длинная страница маршрута: на ней видно, что шапка и нижняя навигация не уезжают. */
function LongPage() {
  return (
    <LegalDocumentPage
      blocks={parseLegalText(terms.text)}
      current={terms}
      edition={terms}
      superseded={[]}
    />
  );
}

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

/** Участник без Telegram: `/api/account` говорит, что связи нет. */
function memberWithoutTelegram(): Pick<
  Story,
  "beforeEach" | "decorators" | "parameters"
> {
  const environment = publicPageEnvironment("/legal/terms", {
    account: "authenticated",
  });
  return {
    ...environment,
    beforeEach: [
      environment.beforeEach,
      fetchBeforeRender(
        respondByPath({
          "/api/account": () =>
            accountPresentationResponse({ link: { kind: "unlinked" } }),
        }),
      ),
    ],
  };
}

const meta = {
  title: "Patterns/Application shell",
  parameters: {
    docs: {
      description: {
        component:
          "Публичная оболочка в том составе, который надевает `PublicShell`: шапка на desktop, нижняя навигация на телефоне, напоминание о Telegram, окно подключения и подвал. Разделы шапки зависят от прав: «Редактор» видит только тот, кто ведёт материалы. Страницы внутри — настоящие маршруты.",
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Гость: шапка с входом остаётся на месте, пока прокручивается содержание. */
export const GuestDesktop: Story = {
  ...publicPageEnvironment("/legal/terms"),
  globals: desktop,
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByRole("banner");
    await expect(
      within(header).getByRole("link", { name: "Sachkov Inside" }),
    ).toBeVisible();
    await expect(
      within(header).getByRole("button", { name: "Войти" }),
    ).toBeVisible();
    const navigation = within(header).getByRole("navigation", {
      name: "Основная",
    });
    await expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Главная", "Закладки"]);
    // На desktop прокручивается `main` оболочки, а шапка остаётся на месте.
    const main = canvas.getByRole("main");
    const headerTop = header.getBoundingClientRect().top;
    main.scrollTop = 500;
    await expect(main.scrollTop).toBeGreaterThan(0);
    await expect(header.getBoundingClientRect().top).toBe(headerTop);
    main.scrollTop = 0;
  },
};

/** Автор материалов: шапка добавляет «Редактор» последним разделом. */
export const AuthorDesktop: Story = {
  ...publicPageEnvironment("/legal/terms", { account: "author" }),
  globals: desktop,
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const navigation = within(canvasElement).getByRole("navigation", {
      name: "Основная",
    });
    const links = within(navigation).getAllByRole("link");
    await expect(links.map((link) => link.textContent)).toEqual([
      "Главная",
      "Закладки",
      "Редактор",
    ]);
    await expect(links.at(-1)).toHaveAttribute(
      "href",
      authoringMaterialsRootHref,
    );
  },
};

/**
 * Участник без Telegram закрыл окно подключения: в шапке остаётся тихое напоминание, и оно же
 * открывает окно снова.
 */
export const MemberWithoutTelegramDesktop: Story = {
  ...memberWithoutTelegram(),
  globals: desktop,
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.queryByRole("dialog")).not.toBeInTheDocument();
    const reminder = await canvas.findByRole("button", {
      name: "Telegram не подключён. Подключить",
    });
    await userEvent.click(reminder);
    const dialog = await body.findByRole("dialog");
    await expect(
      within(dialog).getByRole("heading", { name: "Подключите Telegram" }),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Закрыть подключение Telegram",
      }),
    );
    await waitFor(() =>
      expect(body.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

/** На телефоне то же напоминание — точка у «Профиля» в нижней навигации. */
export const MemberWithoutTelegramMobile: Story = {
  ...memberWithoutTelegram(),
  globals: mobile,
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const navigation = within(canvasElement).getByRole("navigation", {
      name: "Мобильная навигация",
    });
    const profile = within(navigation).getByRole("link", { name: "Профиль" });
    await waitFor(() =>
      expect(profile.querySelector("span[aria-hidden='true']")).not.toBeNull(),
    );
  },
};

/**
 * Телефон 320: шапки нет, нижняя навигация держит цели не меньше 44px, остаётся на месте при
 * прокрутке документа и не даёт странице уйти вбок.
 */
export const MobileBottomNavigation: Story = {
  ...publicPageEnvironment("/legal/terms"),
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("banner")).not.toBeInTheDocument();
    const navigation = canvas.getByRole("navigation", {
      name: "Мобильная навигация",
    });
    const links = within(navigation).getAllByRole("link");
    await expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Главная",
      "Закладки",
      "Профиль",
    ]);
    await expect(
      links.every((link) => link.getBoundingClientRect().height >= 44),
    ).toBe(true);
    const document = canvasElement.ownerDocument;
    const scrollRoot = document.scrollingElement;
    if (scrollRoot === null) throw new Error("Документ не прокручивается");
    const before = navigation.getBoundingClientRect().top;
    scrollRoot.scrollTop = 600;
    await expect(scrollRoot.scrollTop).toBeGreaterThan(0);
    await expect(navigation.getBoundingClientRect().top).toBe(before);
    scrollRoot.scrollTop = 0;
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  },
};

/** Короткая страница: подвал стоит внизу экрана, а не сразу под текстом. */
function shortPageFooter(viewport: typeof desktop | typeof mobile): Story {
  return {
    ...publicPageEnvironment("/does-not-exist"),
    globals: viewport,
    render: () => <PageNotFound />,
    play: async ({ canvasElement }) => {
      const footer = canvasElement.querySelector("footer");
      if (footer === null) throw new Error("В оболочке нет подвала");
      const view = canvasElement.ownerDocument.defaultView;
      if (view === null) throw new Error("У story нет окна");
      const { bottom } = footer.getBoundingClientRect();
      // Ниже подвала остаётся только нижний отступ страницы и место под мобильную навигацию.
      await expect(bottom).toBeGreaterThan(view.innerHeight - 200);
      await expect(bottom).toBeLessThanOrEqual(view.innerHeight);
    },
  };
}

export const ShortPageFooterDesktop: Story = shortPageFooter(desktop);
export const ShortPageFooterMobile: Story = shortPageFooter(mobile);
