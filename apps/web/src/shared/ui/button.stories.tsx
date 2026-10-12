import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trash2 } from "lucide-react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

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
      // Только размеры, которые продукт использует; `xs`, `icon-xs` и `icon-sm` остались в
      // примитиве из генератора, но ни одна поверхность их не ставит.
      options: ["sm", "default", "lg", "icon", "icon-lg"],
    },
    variant: {
      control: "select",
      options: [
        "default",
        "outline",
        "secondary",
        "ghost",
        "destructive",
        "link",
      ],
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
    docs: {
      description: {
        story: "The single highest-priority action in a local task.",
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", {
      name: "Сохранить",
    });

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
    docs: {
      description: {
        story:
          "A safe alternative that should not compete with primary intent.",
      },
    },
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
    docs: {
      description: {
        story:
          "Reserved for an action with a material destructive consequence.",
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    children: "Недоступно",
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Communicates unavailable action state without removing its context.",
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", {
      name: "Недоступно",
    });

    await expect(button).toBeDisabled();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const CompactMobileActions: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  render: (args) => (
    <div className="grid w-64 max-w-full gap-4 p-2">
      <Button {...args} className="min-h-12 px-4 text-base">
        <Trash2 className="size-5" aria-hidden="true" />
        Сохранить
      </Button>
      <Button className="min-h-14 whitespace-normal px-4" variant="outline">
        Отправить комментарий к выполненному заданию на проверку
      </Button>
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    await canvasElement.ownerDocument.fonts.ready;
    const button = within(canvasElement).getByRole("button", {
      name: "Сохранить",
    });
    const bounds = button.getBoundingClientRect();
    await expect(bounds.height).toBe(36);
    await expect(
      button.querySelector("svg")?.getBoundingClientRect().width,
    ).toBe(16);
    await waitFor(async () => {
      const currentBounds = button.getBoundingClientRect();
      const hit = canvasElement.ownerDocument.elementFromPoint(
        currentBounds.x + currentBounds.width / 2,
        currentBounds.y - 3,
      );
      await expect(
        hit !== null && button.contains(hit),
        JSON.stringify({
          x: currentBounds.x,
          y: currentBounds.y,
          height: currentBounds.height,
          hit: hit?.tagName,
        }),
      ).toBe(true);
    });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
    const multiline = within(canvasElement).getByRole("button", {
      name: /Отправить комментарий/u,
    });
    await expect(multiline.scrollHeight).toBeLessThanOrEqual(
      multiline.clientHeight,
    );
  },
};
export const CompactMobileActions320: Story = {
  ...CompactMobileActions,
  globals: { viewport: { value: "mobile320", isRotated: false } },
};
