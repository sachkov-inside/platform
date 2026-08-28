import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trash2 } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";

import { Button } from "@/shared/ui/button";

const meta = {
  args: {
    children: "Сохранить",
    onClick: fn(),
    size: "default",
    variant: "default",
  },
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "default", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"],
    },
    variant: {
      control: "select",
      options: ["default", "outline", "secondary", "ghost", "destructive", "link"],
    },
  },
  component: Button,
  parameters: {
    docs: {
      description: {
        component:
          "Action primitive with semantic visual variants. Use one primary action per local task and label icon-only actions explicitly.",
      },
    },
    layout: "centered",
  },
  title: "Components/Actions/Button",
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PrimaryAction: Story = {
  name: "Primary action",
  parameters: {
    docs: { description: { story: "The single highest-priority action in a local task." } },
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Сохранить" });

    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const SecondaryAction: Story = {
  args: {
    children: "Отмена",
    variant: "secondary",
  },
  name: "Secondary action",
  parameters: {
    docs: { description: { story: "A safe alternative that should not compete with primary intent." } },
  },
};

export const DestructiveAction: Story = {
  args: {
    children: (
      <>
        <Trash2 aria-hidden="true" />
        Удалить
      </>
    ),
    variant: "destructive",
  },
  name: "Destructive action",
  parameters: {
    docs: { description: { story: "Reserved for an action with a material destructive consequence." } },
  },
};

export const Disabled: Story = {
  args: {
    children: "Недоступно",
    disabled: true,
  },
  parameters: {
    docs: { description: { story: "Communicates unavailable action state without removing its context." } },
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Недоступно" });

    await expect(button).toBeDisabled();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
