import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { flushSync } from "react-dom";
import { expect, fn, spyOn, within } from "storybook/test";

import { memberProfile } from "@/storybook/account.fixtures";
import { accountSectionEnvironment } from "@/storybook/story-environment";

import { ProfileAvatarEditor } from "./profile-avatar-editor.client";

function AvatarPage(props: ComponentProps<typeof ProfileAvatarEditor>) {
  const [mounted, setMounted] = useState(true);
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
      {mounted ? <ProfileAvatarEditor {...props} /> : <p>Другая страница</p>}
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
    const response = await fetch("/images/sachkov-dev-avatar.webp");
    if (!response.ok) throw new Error("Missing local avatar image fixture");
    const file = new File([await response.blob()], "avatar.webp", {
      type: "image/webp",
    });
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
      await expect(canvas.getByText("Другая страница")).toBeVisible();
      await expect(created).toHaveBeenCalledTimes(1);
      await expect(released).toHaveBeenCalledWith(
        created.mock.results[0]?.value,
      );
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
