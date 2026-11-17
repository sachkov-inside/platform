import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, type ComponentProps, useState } from "react";
import { flushSync } from "react-dom";
import { expect, fn, spyOn, userEvent, within } from "storybook/test";

import { memberProfile } from "@/storybook/account.fixtures";
import { accountSectionEnvironment } from "@/storybook/story-environment";

import { ProfileAvatarEditor } from "./profile-avatar-editor.client";

function AvatarPage(props: ComponentProps<typeof ProfileAvatarEditor>) {
  const [mounted, setMounted] = useState(true);
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setMounted(false);
        }}
        type="button"
      >
        Уйти со страницы
      </button>
      <button
        onClick={() => {
          setVisible(false);
        }}
        type="button"
      >
        Скрыть страницу
      </button>
      <button
        onClick={() => {
          setVisible(true);
        }}
        type="button"
      >
        Вернуться на страницу
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? <ProfileAvatarEditor {...props} /> : <p>Другая страница</p>}
      </Activity>
    </>
  );
}

const meta = {
  component: ProfileAvatarEditor,
  title: "Components/Account/Avatar",
  args: { profile: memberProfile, onProfileChange: fn() },
  ...accountSectionEnvironment("/account"),
} satisfies Meta<typeof ProfileAvatarEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

async function avatarFile() {
  const response = await fetch("/images/sachkov-dev-avatar.webp");
  if (!response.ok) throw new Error("Missing local avatar image fixture");
  return new File([await response.blob()], "avatar.webp", {
    type: "image/webp",
  });
}

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Добавить фото" }),
    ).toBeVisible();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const LeaveBeforeImageDecodes: Story = {
  render: (args) => <AvatarPage {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText<HTMLInputElement>(
      "Выбрать изображение для аватара",
    );
    const file = await avatarFile();
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const created = spyOn(URL, "createObjectURL");
    const released = spyOn(URL, "revokeObjectURL");
    try {
      input.files = transfer.files;
      flushSync(() => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      flushSync(() => {
        canvas.getByRole("button", { name: "Уйти со страницы" }).click();
      });
      const ownedUrl: unknown = created.mock.results[0]?.value;
      const releasedBeforeYield = released.mock.calls.some(
        ([url]) => url === ownedUrl,
      );
      await expect(canvas.getByText("Другая страница")).toBeVisible();
      await expect(created).toHaveBeenCalledTimes(1);
      await expect(releasedBeforeYield).toBe(true);
    } finally {
      const results = [...created.mock.results];
      created.mockRestore();
      released.mockRestore();
      for (const result of results) {
        const url: unknown = result.value;
        if (typeof url === "string") URL.revokeObjectURL(url);
      }
    }
  },
};

export const RetainedCropReleasesModalAndReturns: Story = {
  render: (args) => <AvatarPage {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(
      canvas.getByLabelText("Выбрать изображение для аватара"),
      await avatarFile(),
    );
    const dialog = await within(document.body).findByRole<HTMLDialogElement>(
      "dialog",
      { name: "Кадрировать аватар" },
    );
    try {
      await expect(dialog.matches(":modal")).toBe(true);
      flushSync(() => {
        canvas.getByRole("button", { name: "Скрыть страницу" }).click();
      });
      const modalAtHide = dialog.matches(":modal");
      flushSync(() => {
        canvas.getByRole("button", { name: "Вернуться на страницу" }).click();
      });
      await expect(modalAtHide).toBe(false);
      await expect(
        canvas.getByRole("dialog", { name: "Кадрировать аватар" }),
      ).toBe(dialog);
      await expect(dialog.matches(":modal")).toBe(true);
      await expect(
        within(dialog).getByRole("slider", { name: "Масштаб" }),
      ).toHaveValue("1");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Отмена" }),
      );
      await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      flushSync(() => {
        canvas.getByRole("button", { name: "Уйти со страницы" }).click();
      });
      if (dialog.open) dialog.close();
    }
  },
};
