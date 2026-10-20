import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { MaterialReadingScope } from "@/entities/material";
import { accountSectionEnvironment } from "@/storybook/story-environment";
import {
  accountPresentationResponse,
  memberAccountId,
  respondByPath,
  subscribedMemberRoutes,
} from "@/storybook/account.fixtures";
import {
  currentBillingResponse,
  courseEnrollment,
  enrollmentsResponse,
} from "@/storybook/billing.fixtures";
import { AccountAccessPage } from "./account-access-page.client";

const courseContent = (courseEnrollment.content ?? []).map((entry) => ({
  ...entry,
  title: "Inside AI Engineering",
  slug: "inside-ai-engineering",
}));

const environment = accountSectionEnvironment("/account", {
  fetch: () =>
    respondByPath({
      ...subscribedMemberRoutes,
      "/api/account/billing": () =>
        currentBillingResponse(null, {
          grounds: [
            {
              source: "manual",
              capabilities: ["materials", "community"],
              startsAt: courseEnrollment.startsAt,
              validUntil: null,
              active: true,
              content: courseContent,
            },
            {
              source: "manual",
              capabilities: ["support"],
              startsAt: courseEnrollment.startsAt,
              validUntil: "2027-03-14T10:00:00.000Z",
              active: true,
              content: courseContent,
            },
          ],
        }),
      "/api/personal-home": () =>
        Response.json({
          kind: "ready",
          continuation: {
            series: {
              collection: {
                id: "00000000-0000-4000-8000-000000000f01",
                slug: "inside-ai-engineering",
                name: "Inside AI Engineering",
                summary: null,
                cover: null,
                count: 17,
                previewItems: [],
              },
              read: 0,
              total: 17,
            },
          },
        }),
      "/api/account/community-entry": () =>
        Response.json({
          ok: true,
          value: { kind: "join", botUrl: "https://t.me/example_bot" },
        }),
    }),
});
const meta = {
  component: AccountAccessPage,
  title: "Pages/Account/Live cabinet",
  args: { policies: [] },
  decorators: [
    (Story) => (
      <MaterialReadingScope
        value={{
          accountId: memberAccountId,
          resolved: true,
          states: new Map(),
          failed: false,
          register: () => () => undefined,
          refresh: () => Promise.resolve(),
        }}
      >
        <Story />
      </MaterialReadingScope>
    ),
  ],
} satisfies Meta<typeof AccountAccessPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithProducts: Story = {
  ...environment,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Личный кабинет" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("heading", { name: "Подписка" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Отменить продление" }),
    ).not.toBeInTheDocument();
    await expect(
      await canvas.findByRole("heading", { name: "Мои продукты" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("link", { name: "Вступить в сообщество" }),
    ).toBeVisible();
    await expect(
      canvas.queryByText("Готово. Аккаунт связан с ботом платформы."),
    ).not.toBeInTheDocument();
    await expect(
      await canvas.findByRole("textbox", { name: "Отображаемое имя" }),
    ).toHaveValue("Кирилл Сачков");
    await expect(
      canvas.queryByRole("textbox", { name: /О себе/ }),
    ).not.toBeInTheDocument();
  },
};
export const WithoutPurchases: Story = {
  ...accountSectionEnvironment("/account", {
    fetch: () =>
      respondByPath({
        ...subscribedMemberRoutes,
        "/api/account/billing": () => currentBillingResponse(null),
        "/api/account/billing/enrollments": () => enrollmentsResponse([]),
      }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Telegram" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("heading", { name: "Подписка" }),
    ).not.toBeInTheDocument();
  },
};
export const Mobile: Story = {
  ...WithProducts,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const FirstEmailAttachment: Story = {
  ...accountSectionEnvironment("/account", {
    fetch: () => {
      let email: string | null = null;
      return respondByPath({
        ...subscribedMemberRoutes,
        "/api/account/email": () => Response.json({ ok: true, email }),
        "/api/account/email/start": () =>
          Response.json({ ok: true, challengeRef: "synthetic-challenge" }),
        "/api/account/email/confirm": () => {
          email = "new@example.test";
          return Response.json({ ok: true });
        },
      });
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Добавить почту" }),
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Адрес почты" }),
      "new@example.test",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Получить код" }));
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "Код из письма" }),
      "123456",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Подтвердить почту" }),
    );
    await expect(await canvas.findByText("new@example.test")).toBeVisible();
    await expect(
      canvas.getByText(/Почта подтверждена и привязана/),
    ).toBeVisible();
  },
};

/** The first visit keeps profile settings ahead of learning and uses one contact group. */
export const NewMember: Story = {
  ...accountSectionEnvironment("/account", {
    fetch: () =>
      respondByPath({
        ...subscribedMemberRoutes,
        "/api/account": () =>
          accountPresentationResponse({
            link: { kind: "unlinked" },
            profile: null,
          }),
        "/api/account/email": () => Response.json({ ok: true, email: null }),
        "/api/account/billing": () => currentBillingResponse(null),
        "/api/account/billing/enrollments": () => enrollmentsResponse([]),
      }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const personal = within(
      await canvas.findByRole("region", { name: "Личные данные" }),
    );
    await expect(
      personal.getByRole("textbox", { name: "Отображаемое имя" }),
    ).toBeVisible();
    const connections = within(
      await canvas.findByRole("region", { name: "Контакты и вход" }),
    );
    await expect(
      await connections.findByRole("button", { name: "Добавить почту" }),
    ).toBeVisible();
    await expect(
      connections.getByRole("button", { name: "Подключить" }),
    ).toBeVisible();
    for (const text of [
      "От 2 до 80 символов. Имя может повторяться.",
      "Почта для входа и подключённый Telegram.",
      "Подключите бота платформы — это займёт меньше минуты.",
    ]) {
      await expect(canvas.queryByText(text)).not.toBeInTheDocument();
    }
  },
};
