import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { AdminSearchSelect } from "./admin-search-select.client";

const meta = {
  title: "Features/Access/Searchable owner choices",
  component: AdminSearchSelect,
  args: {
    label: "Предложение",
    name: "offerId",
    defaultValue: "999",
    options: Array.from({ length: 1000 }, (_, index) => ({
      value: String(index),
      label: `Предложение ${String(index).padStart(4, "0")}`,
    })),
  },
  render: (args) => (
    <form>
      <AdminSearchSelect {...args} />
    </form>
  ),
  parameters: { layout: "padded" },
} satisfies Meta<typeof AdminSearchSelect>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SearchKeepsSelection: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const select = page.getByRole("combobox", { name: "Предложение" });
    await expect(select).toHaveValue("999");
    await expect(
      within(select).getAllByRole("option").length,
    ).toBeLessThanOrEqual(22);
    await userEvent.type(page.getByRole("searchbox"), "Предложение 0700");
    await userEvent.selectOptions(select, "700");
    await userEvent.clear(page.getByRole("searchbox"));
    await expect(select).toHaveValue("700");
    await expect(
      within(select).getAllByRole("option").length,
    ).toBeLessThanOrEqual(22);
    await userEvent.type(page.getByRole("searchbox"), "Нет такого предложения");
    await expect(select).toHaveValue("700");
    const form = canvasElement.querySelector("form");
    if (form === null) throw new Error("Form missing");
    await expect(new FormData(form).get("offerId")).toBe("700");
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
