import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import type { PrivateMemberProfile, ProfileMutationState } from "../model/member-profile";
import { AccountPageClient } from "./account-page.client";

const activeProfile = {
  bio: "Развиваю инженерные команды и изучаю agent-first delivery.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл Сачков",
  publicProfileId: "5d34da22-548e-4b02-b6e8-9c918ad536ef",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 3,
} as const satisfies PrivateMemberProfile;

function preserveState(
  state: ProfileMutationState,
): Promise<ProfileMutationState> {
  return Promise.resolve(state);
}

function conflictState(): Promise<ProfileMutationState> {
  return Promise.resolve({ currentVersion: 4, kind: "conflict" });
}

const meta = {
  args: {
    deleteAction: preserveState,
    initialProfile: activeProfile,
    saveAction: preserveState,
  },
  component: AccountPageClient,
  parameters: {
    docs: {
      description: {
        component:
          "Production Private Account surface. The editor and exact member projection share the same accepted fields; no avatar or file workflow is present in #51.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Account/Production",
} satisfies Meta<typeof AccountPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Active · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Ваш профиль" })).toBeInTheDocument();
    await expect(canvas.getByLabelText("Имя")).toHaveValue("Кирилл Сачков");
    await expect(canvas.getAllByText("Кирилл Сачков")).toHaveLength(1);
    await expect(canvas.getByText("Видят участники")).toBeInTheDocument();
    await expect(canvas.queryByText(/аватар/iu)).not.toBeInTheDocument();
  },
};

export const ActiveMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Active · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("heading", { name: "Редактирование" });
    const preview = canvas.getByRole("heading", { name: "Точная проекция" });
    await expect(editor.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    await expect(canvas.getByRole("button", { name: "Создать" })).toBeInTheDocument();
    await expect(
      canvas.getByText(/получит новый непредсказуемый публичный адрес/iu),
    ).toBeInTheDocument();
  },
};

export const Conflict: Story = {
  args: { saveAction: conflictState },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("О себе · необязательно"), " Дополнение.");
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(
      canvas.getByText("Профиль уже изменился в другой вкладке."),
    ).toBeInTheDocument();
  },
};
