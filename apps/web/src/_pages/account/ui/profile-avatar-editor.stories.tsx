import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import type { PrivateMemberProfile } from "@/entities/member-profile";
import {
  ProfileAvatarEditor,
  type ProfileAvatarMutation,
} from "./profile-avatar-editor.client";

const profile = {
  avatar: null,
  bio: "Развиваю инженерные команды.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл Сачков",
  publicProfileId: "5d34da22-548e-4b02-b6e8-9c918ad536ef",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 3,
} as const satisfies PrivateMemberProfile;

const pendingMutation = (progress: number): ProfileAvatarMutation =>
  (_input, onProgress) => {
    onProgress(progress);
    return new Promise(() => undefined);
  };

const meta = {
  args: {
    mutation: pendingMutation(0.42),
    onProfileChange: fn(),
    profile,
  },
  component: ProfileAvatarEditor,
  parameters: {
    docs: {
      description: {
        component:
          "Owner-only Profile avatar chooser, drop/paste target, keyboard-operable circular crop, progress, processing, replacement, and removal states.",
      },
    },
  },
  title: "Pages/Account/Profile avatar",
} satisfies Meta<typeof ProfileAvatarEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CropDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: openCrop,
};

export const CropMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async (context) => {
    await openCrop(context);
    await expect(context.canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      context.canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

export const Uploading: Story = {
  play: async (context) => {
    const dialog = await chooseImage(context.canvasElement);
    await userEvent.click(dialog.getByRole("button", { name: "Сохранить аватар" }));
    await expect(dialog.getByText("Загружаем… 42%")).toBeInTheDocument();
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("value", "0.42");
    await expect(
      within(context.canvasElement).getByLabelText(
        "Выбрать изображение для аватара",
      ),
    ).toBeDisabled();
  },
};

export const Processing: Story = {
  args: { mutation: pendingMutation(1) },
  play: async (context) => {
    const dialog = await chooseImage(context.canvasElement);
    await userEvent.click(dialog.getByRole("button", { name: "Сохранить аватар" }));
    await expect(
      dialog.getByText("Файл загружен. Сервер создаёт безопасные размеры…"),
    ).toBeInTheDocument();
  },
};

export const Saved: Story = {
  args: {
    mutation: () => Promise.resolve({
      ...profile,
      avatar: { avatarId: "d3acb421-85e2-4c79-9dfa-4b2c925e56e8" },
      version: 4,
    }),
  },
  play: async ({ canvasElement }) => {
    const dialog = await chooseImage(canvasElement);
    await userEvent.click(dialog.getByRole("button", { name: "Сохранить аватар" }));
    await expect(
      await within(canvasElement).findByRole("status"),
    ).toHaveTextContent("Аватар сохранён.");
  },
};

export const RecoverableError: Story = {
  args: {
    mutation: () => Promise.reject(new Error("storage unavailable")),
  },
  play: async (context) => {
    const dialog = await chooseImage(context.canvasElement);
    await userEvent.click(dialog.getByRole("button", { name: "Сохранить аватар" }));
    await expect(
      dialog.getByRole("alert", { name: "" }),
    ).toHaveTextContent("Не удалось изменить аватар");
    await expect(dialog.getByRole("button", { name: "Сохранить аватар" })).toBeEnabled();
  },
};

export const Removing: Story = {
  args: {
    profile: { ...profile, avatar: { avatarId: "d3acb421-85e2-4c79-9dfa-4b2c925e56e8" } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Удалить" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Удаляем аватар…");
    await expect(canvas.getByRole("button", { name: "Удаляем…" })).toBeDisabled();
  },
};

export const Removed: Story = {
  args: {
    mutation: () => Promise.resolve({ ...profile, avatar: null, version: 4 }),
    profile: { ...profile, avatar: { avatarId: "d3acb421-85e2-4c79-9dfa-4b2c925e56e8" } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Удалить" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Аватар удалён.");
  },
};

async function openCrop(context: { readonly canvasElement: HTMLElement }) {
  const dialog = await chooseImage(context.canvasElement);
  await expect(dialog.getByRole("heading", { name: "Кадрировать аватар" })).toBeInTheDocument();
  const horizontal = dialog.getByLabelText("По горизонтали");
  horizontal.focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect(horizontal.ownerDocument.activeElement).toBe(horizontal);
  await expect(dialog.getByLabelText("Масштаб")).toBeInTheDocument();
}

async function chooseImage(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.upload(
    canvas.getByLabelText("Выбрать изображение для аватара"),
    avatarFile(),
  );
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog", {
      name: "Кадрировать аватар",
    }),
  );
}

function avatarFile(): File {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwMAAAAsAAQF0kQ0AAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  return new File([bytes], "avatar.png", { type: "image/png" });
}
