import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";

const meta = {
  component: Sheet,
  parameters: {
    docs: {
      description: {
        component:
          "Modal supplementary surface for a bounded task. It owns focus while open and returns focus to its trigger when dismissed.",
      },
    },
    layout: "centered",
  },
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Открыть фильтры</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Фильтры</SheetTitle>
          <SheetDescription>Уточните формат материалов в текущей выдаче.</SheetDescription>
        </SheetHeader>
        <fieldset className="grid gap-3 px-4">
          <legend className="mb-2 text-sm font-semibold">Формат</legend>
          {[
            ["guide", "Гайд"],
            ["video", "Видео"],
          ].map(([value, label]) => (
            <label className="flex min-h-11 items-center gap-3" key={value}>
              <input className="size-4 accent-accent" name="format" type="checkbox" value={value} />
              {label}
            </label>
          ))}
        </fieldset>
        <SheetFooter>
          <Button>Показать материалы</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
  title: "Components/Overlays/Sheet",
} satisfies Meta<typeof Sheet>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MobileFilters: Story = {
  name: "Mobile filters",
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile320",
    },
  },
  parameters: {
    docs: { description: { story: "Moves secondary Library filters into a focused mobile task." } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "Открыть фильтры" });

    await userEvent.click(trigger);
    const dialog = body.getByRole("dialog", { name: "Фильтры" });
    await expect(dialog).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Видео" }));
    await expect(within(dialog).getByRole("checkbox", { name: "Видео" })).toBeChecked();
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toHaveAttribute("data-state", "closed");
    await waitFor(async () => {
      await expect(trigger).toHaveFocus();
    });
  },
};
