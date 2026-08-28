import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

const meta = {
  args: {
    defaultValue: "relevance",
  },
  component: Select,
  parameters: {
    docs: {
      description: {
        component:
          "Accessible choice control for a compact, known option set. The visible trigger always has a programmatic label.",
      },
    },
    layout: "centered",
  },
  render: (args) => (
    <div className="w-64">
      <label className="mb-2 block text-sm font-semibold" htmlFor="storybook-sort">
        Сортировка
      </label>
      <Select {...args}>
        <SelectTrigger aria-label="Сортировка" id="storybook-sort">
          <SelectValue placeholder="Выберите порядок" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="relevance">По релевантности</SelectItem>
          <SelectItem value="title">По названию</SelectItem>
          <SelectItem value="newest">Сначала новые</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
  title: "Components/Inputs/Select",
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultSelection: Story = {
  name: "Default selection",
  parameters: {
    docs: { description: { story: "A preselected sort order that can be changed without submitting a form." } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "Сортировка" });

    await expect(trigger).toHaveTextContent("По релевантности");
    await userEvent.click(trigger);
    await userEvent.click(body.getByRole("option", { name: "По названию" }));
    await expect(trigger).toHaveTextContent("По названию");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
  parameters: {
    docs: { description: { story: "Preserves the current value when the surrounding task forbids changes." } },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("combobox", { name: "Сортировка" }),
    ).toBeDisabled();
  },
};
