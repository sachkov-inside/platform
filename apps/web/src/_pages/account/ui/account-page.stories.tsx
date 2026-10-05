import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { ReadingProgressProvider } from "@/features/reading-progress";
import {
  accountPresentationResponse,
  memberAccountId,
  memberProfile,
  pendingResponse,
  respondByPath,
  type RouteResponse,
  subscribedMemberRoutes,
  unauthorizedResponse,
} from "@/storybook/account.fixtures";
import {
  accountSectionEnvironment,
  routeContent,
} from "@/storybook/story-environment";
import { AccountSectionLoading } from "@/widgets/account-cabinet";

import { AccountPageQuery } from "./account-page-query.client";

const path = "/account";

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

/** Продолжение обучения участника: продукт, который он читает. */
const continuationResponse: RouteResponse = () =>
  Response.json({
    kind: "ready",
    continuation: {
      series: {
        collection: {
          id: "00000000-0000-4000-8000-00000000d001",
          slug: "platform-inside",
          name: "Создание Platform Inside",
          summary: null,
          cover: null,
          count: 12,
          previewItems: [],
        },
        read: 4,
        total: 12,
      },
    },
  });

/**
 * Раздел «Профиль» в кабинете. Прогресс чтения на маршруте даёт оболочка; здесь тот же провайдер
 * знает аккаунт участника, поэтому продолжение обучения читается так же, как в приложении.
 */
function profilePage(
  routes: () => Readonly<Record<string, RouteResponse>> = () => ({}),
): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  const environment = accountSectionEnvironment(path, {
    fetch: () =>
      respondByPath({
        ...subscribedMemberRoutes,
        "/api/personal-home": continuationResponse,
        ...routes(),
      }),
  });
  return {
    ...environment,
    decorators: [
      (Story) => (
        <ReadingProgressProvider accountId={memberAccountId} resolved>
          <Story />
        </ReadingProgressProvider>
      ),
      ...environment.decorators,
    ],
  };
}

const meta = {
  component: AccountPageQuery,
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Профиль» маршрута `/account`: продолжение обучения, редактор полей и защищённая загрузка аватара. Связь с Telegram, покупки и уведомления живут в своих разделах кабинета.",
      },
    },
  },
  title: "Pages/Account/Profile",
} satisfies Meta<typeof AccountPageQuery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveDesktop: Story = {
  ...profilePage(),
  globals: desktop,
  name: "Active · desktop",
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Профиль" }),
    ).toBeInTheDocument();
    // Продолжение обучения стоит над профилем, как его составляет маршрут.
    await expect(
      await canvas.findByRole("link", {
        name: "Продолжить продукт Создание Platform Inside",
      }),
    ).toHaveAttribute("href", expect.stringContaining("platform-inside"));
    // Профиль показан один раз и правится на месте: отдельной проекции рядом нет.
    await expect(canvas.getByLabelText("Имя")).toHaveValue("Кирилл Сачков");
    await expect(
      canvas.queryByRole("heading", { name: "Редактирование" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Сохранить" }),
    ).toBeDisabled();
    // Профиль виден только владельцу: ссылки для участников нет.
    await expect(
      canvas.getByText(/^Профиль заполняется по желанию и виден только вам\./u),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText(/для участников|\/members\//u),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Аватар" }),
    ).toBeInTheDocument();
    // Ни один раздел не показывает задачи другого.
    await expect(
      canvas.queryByText(/Telegram/u, {
        ignore: "script, style, [data-account-section-nav] *",
      }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Выйти из аккаунта" }),
    ).not.toBeInTheDocument();
  },
};

export const ActiveMobile: Story = {
  ...profilePage(),
  globals: mobile,
  name: "Active · mobile",
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    const name = await canvas.findByLabelText("Имя");
    const about = canvas.getByLabelText("О себе · необязательно");
    await expect(
      name.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};

/** Участник ещё ничего не открывал: место продолжения объясняет, что здесь появится. */
export const LearningContinuationEmpty: Story = {
  ...profilePage(() => ({
    "/api/personal-home": () =>
      Response.json({ kind: "ready", continuation: {} }),
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText(
        "Откройте материал — здесь появится продолжение обучения.",
      ),
    ).toBeInTheDocument();
  },
};

/** Продолжение не прочиталось: профиль остаётся доступным. */
export const LearningContinuationUnavailable: Story = {
  ...profilePage(() => ({
    "/api/personal-home": () => new Response(null, { status: 503 }),
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(
      await canvas.findByText("Не удалось загрузить продолжение обучения."),
    ).toBeInTheDocument();
    await expect(await canvas.findByLabelText("Имя")).toBeInTheDocument();
  },
};

export const Disabled: Story = {
  ...profilePage(() => ({
    "/api/account": () =>
      accountPresentationResponse({
        profile: { ...memberProfile, status: "disabled" },
      }),
  })),
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText("Профиль скрыт модерацией"),
    ).toBeInTheDocument();
  },
};

export const Missing: Story = {
  ...profilePage(() => ({
    "/api/account": () => accountPresentationResponse({ profile: null }),
  })),
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Создать профиль" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText(/ссылку для участников/iu),
    ).not.toBeInTheDocument();
  },
};

export const ProfileConflict: Story = {
  ...profilePage(() => ({
    "/api/account/profile": () =>
      Response.json({ currentVersion: 4, kind: "conflict" }),
  })),
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await userEvent.type(
      await canvas.findByLabelText("О себе · необязательно"),
      " Дополнение.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(
      await canvas.findByText("Профиль уже изменился в другой вкладке."),
    ).toBeInTheDocument();
  },
};

/** Раздел ждёт `/api/account`: заголовок раздела уже на месте. */
export const Loading: Story = {
  ...profilePage(() => ({ "/api/account": pendingResponse })),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Загружаем раздел…"),
    ).toBeInTheDocument();
  },
};

/** Скелет маршрута из `account/loading.tsx`: рамка кабинета стоит, раздел ещё не пришёл. */
export const SectionLoading: Story = {
  ...profilePage(),
  render: () => <AccountSectionLoading />,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("status")).toHaveTextContent(
      "Загружаем раздел…",
    );
    await expect(
      within(canvasElement).getAllByRole("navigation", {
        name: "Разделы кабинета",
      }).length,
    ).toBeGreaterThan(0);
  },
};

/** Сессия закончилась: раздел просит войти и возвращает в профиль. */
export const SignInRequired: Story = {
  ...profilePage(() => ({ "/api/account": unauthorizedResponse })),
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Войдите в аккаунт" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Войти" }).closest("form"),
    ).toHaveAttribute("action", "/auth/sign-in");
  },
};

/** `/api/account` не ответил: раздел называет код, который ставит маршрут. */
export const PageUnavailable: Story = {
  ...profilePage(() => ({
    "/api/account": () => new Response(null, { status: 503 }),
  })),
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(
      await canvas.findByText("Account временно недоступен"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Код: account-query")).toBeInTheDocument();
  },
};
