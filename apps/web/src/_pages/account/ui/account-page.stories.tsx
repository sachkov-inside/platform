import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import type { PrivateMemberProfile } from "@/entities/member-profile";
import { withMutationFetch } from "@/workshop/mutation-mock";

import { AccountLoading, AccountUnavailable } from "./account-page";
import { AccountPageClient } from "./account-page.client";

const activeProfile = {
  avatar: null,
  bio: "Развиваю инженерные команды и изучаю agent-first delivery.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл Сачков",
  publicProfileId: "5d34da22-548e-4b02-b6e8-9c918ad536ef",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 3,
} as const satisfies PrivateMemberProfile;

const meta = {
  args: { initialProfile: activeProfile },
  component: AccountPageClient,
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Профиль»: редактор полей, защищённая загрузка аватара и точная проекция участника. Связь с Telegram, покупки и уведомления живут в своих разделах кабинета.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Account/Profile",
} satisfies Meta<typeof AccountPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Active · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Профиль" })).toBeInTheDocument();
    // Профиль показан один раз и правится на месте: отдельной проекции рядом нет.
    await expect(canvas.getByLabelText("Имя")).toHaveValue("Кирилл Сачков");
    await expect(
      canvas.queryByRole("heading", { name: "Редактирование" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("heading", { name: "Профиль участника" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await expect(canvas.getByText("Ссылка для участников")).toBeInTheDocument();
    await expect(canvas.queryByText(/жалоб|скачать|удалить профиль/iu)).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Аватар" })).toBeInTheDocument();
    // Ни один раздел не показывает задачи другого.
    await expect(canvas.queryByText(/Telegram/u)).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Выйти из аккаунта" }),
    ).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Загружаем раздел…"),
    ).toBeInTheDocument();
  },
  render: () => <AccountLoading />,
};

export const PageUnavailable: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Account временно недоступен"),
    ).toBeInTheDocument();
  },
  render: () => <AccountUnavailable reference="ACCOUNT-122" />,
};

export const ActiveMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Active · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByLabelText("Имя");
    const about = canvas.getByLabelText("О себе · необязательно");
    await expect(name.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

export const Disabled: Story = {
  args: { initialProfile: { ...activeProfile, status: "disabled" } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Профиль скрыт модерацией"),
    ).toBeInTheDocument();
  },
};

export const Missing: Story = {
  args: { initialProfile: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Создать профиль" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/получит постоянную ссылку для участников/iu),
    ).toBeInTheDocument();
  },
};

export const ProfileConflict: Story = {
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(Response.json({ currentVersion: 4, kind: "conflict" })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("О себе · необязательно"), " Дополнение.");
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(
      canvas.getByText("Профиль уже изменился в другой вкладке."),
    ).toBeInTheDocument();
  },
};
