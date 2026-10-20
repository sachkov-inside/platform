import { currentLegalEdition, parseLegalText } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { LegalDocumentPage } from "@/_pages/legal";
import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import {
  accountPresentationResponse,
  respondByPath,
} from "@/storybook/account.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

const terms = currentLegalEdition("terms");

/** Длинная страница: desktop сохраняет шапку; телефон скрывает её вниз и показывает вверх. */
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
          "Публичная оболочка в том составе, который надевает `PublicShell`: шапка на desktop, шапка с логотипом и значками разделов на телефоне, кнопка подключения Telegram рядом с аватаркой и подвал. Разделы шапки зависят от прав: «Редактор» видит только тот, кто ведёт материалы. Страницы внутри — настоящие маршруты.",
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
      within(header).getByRole("link", { name: "Sachkov Dev" }),
    ).toBeVisible();
    await expect(
      within(header).getByRole("button", { name: "Войти через Telegram" }),
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

/** Участник без Telegram: кнопка подключения находится в шапке рядом с аватаркой, без окна. */
export const MemberWithoutTelegramDesktop: Story = {
  ...memberWithoutTelegram(),
  globals: desktop,
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.queryByRole("dialog")).not.toBeInTheDocument();
    const header = within(canvas.getByRole("banner"));
    await expect(
      await header.findByRole("button", { name: "Подключить Telegram" }),
    ).toBeVisible();
    await expect(header.getByRole("button", { name: "Аккаунт" })).toBeVisible();
    await expect(body.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

/** На телефоне Telegram и аватарка сохраняют отдельные доступные кнопки в шапке. */
export const MemberWithoutTelegramMobile: Story = {
  ...memberWithoutTelegram(),
  globals: mobile,
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const navigation = within(canvasElement).getByRole("navigation", {
      name: "Мобильная навигация",
    });
    const controls = within(navigation);
    await expect(
      await controls.findByRole("button", { name: "Подключить Telegram" }),
    ).toBeVisible();
    await expect(
      controls.getByRole("button", { name: "Аккаунт" }),
    ).toBeVisible();
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole("dialog"),
    ).not.toBeInTheDocument();
  },
};

/**
 * Телефон 320: навигация — шапка сверху (решение владельца 09.10.2026). Логотип ведёт на Главную,
 * значки разделов держат цели не меньше 44px, шапка скрывается вниз и появляется вверх, не давая
 * странице уйти вбок. Нижней панели нет.
 */
export const MobileTopNavigation: Story = {
  ...publicPageEnvironment("/legal/terms"),
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  render: () => <LongPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvasElement.querySelector<HTMLElement>(
      "[data-mobile-header]",
    );
    if (header === null) throw new Error("Нет шапки телефона");
    await expect(header).toBeVisible();
    await expect(
      within(header).getByRole("link", { name: "Главная" }),
    ).toHaveAttribute("href", "/");
    const navigation = canvas.getByRole("navigation", {
      name: "Мобильная навигация",
    });
    const links = within(navigation).getAllByRole("link");
    await expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Закладки",
    ]);
    const signIn = within(navigation).getByRole("button", {
      name: "Войти через Telegram",
    });
    await expect(signIn).toBeVisible();
    await expect(signIn.getBoundingClientRect().height).toBe(36);
    await expect(
      parseFloat(getComputedStyle(signIn, "::before").height),
    ).toBeGreaterThanOrEqual(44);
    await expect(
      links.every((link) => link.getBoundingClientRect().height >= 44),
    ).toBe(true);
    const document = canvasElement.ownerDocument;
    const scrollRoot = document.scrollingElement;
    if (scrollRoot === null) throw new Error("Документ не прокручивается");
    scrollRoot.scrollTop = 600;
    await expect(scrollRoot.scrollTop).toBeGreaterThan(0);
    await waitFor(() =>
      expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
    );
    scrollRoot.scrollTop = 0;
    await waitFor(() => expect(header.getBoundingClientRect().top).toBe(0));
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  },
};

/** Короткая страница: подвал стоит внизу экрана, а не сразу под текстом. */
function shortPageFooter(viewport: typeof desktop | typeof mobile): Story {
  return {
    ...publicPageEnvironment("/legal/terms"),
    globals: viewport,
    render: () => (
      <LegalDocumentPage
        blocks={parseLegalText(terms.text).slice(0, 1)}
        current={terms}
        edition={terms}
        superseded={[]}
      />
    ),
    play: async ({ canvasElement }) => {
      const footer = canvasElement.querySelector(".public-footer-slot footer");
      if (footer === null) throw new Error("В оболочке нет подвала");
      const view = canvasElement.ownerDocument.defaultView;
      if (view === null) throw new Error("У story нет окна");
      const { bottom } = footer.getBoundingClientRect();
      // Ниже подвала остаётся только нижний отступ страницы.
      await expect(bottom).toBeGreaterThan(view.innerHeight - 200);
      await expect(bottom).toBeLessThanOrEqual(view.innerHeight);
    },
  };
}

export const ShortPageFooterDesktop: Story = shortPageFooter(desktop);
export const ShortPageFooterMobile: Story = shortPageFooter(mobile);
