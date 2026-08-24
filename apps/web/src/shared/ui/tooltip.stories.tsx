import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CircleHelp } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";

import { Button } from "@/shared/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";

const meta = {
  component: Tooltip,
  parameters: {
    docs: {
      description: {
        component:
          "A short, non-essential explanation. Never hide required instructions or interactive content inside a tooltip.",
      },
    },
    layout: "centered",
  },
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label="О статусе чтения" size="icon" variant="ghost">
            <CircleHelp aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Статус меняется только вручную</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
  title: "Components/Overlays/Tooltip",
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ExplanatoryHint: Story = {
  name: "Explanatory hint",
  parameters: {
    docs: { description: { story: "Adds optional context to an already accessible icon action." } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "О статусе чтения" });

    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await expect(await body.findByRole("tooltip")).toHaveTextContent(
      "Статус меняется только вручную",
    );
  },
};
