import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  AdminSearchChecklist,
  AdminSearchSelect,
  type AdminChoice,
} from "./admin-search-select.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const choices: readonly AdminChoice[] = [
  { value: "ai", label: "AI Engineering", detail: "29 900 ₽" },
  {
    value: "agents",
    label: "Агентная разработка: от первого агента до команды агентов",
    detail: "19 900 ₽",
  },
  ...Array.from({ length: 60 }, (_, index) => ({
    value: `workshop-${String(index + 1)}`,
    label: `Практикум по инженерии ${String(index + 1).padStart(2, "0")}`,
    detail: `${String(9_900 + index * 100)} ₽`,
  })),
];

function Choices() {
  const [single, setSingle] = useState("");
  const [many, setMany] = useState<readonly string[]>(["agents"]);
  return (
    <div className="grid max-w-xl gap-8 p-4">
      <AdminSearchSelect
        label="Продукт"
        onValueChange={setSingle}
        options={choices}
        placeholder="Выберите продукт"
        value={single}
      />
      <AdminSearchChecklist
        emptySelection="Ничего не выбрано: скидка действует на все продукты."
        label="Продукты"
        onValuesChange={setMany}
        options={choices}
        values={many}
      />
    </div>
  );
}

const meta = {
  title: "Components/Админка/Выбор из длинного списка",
  component: Choices,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Choices>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BoundedDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const select = page.getByRole("combobox", { name: "Продукт" });
    // Не больше двадцати вариантов и подсказки в разметке за раз.
    await expect(
      within(select).getAllByRole("option").length,
    ).toBeLessThanOrEqual(21);
    await expect(page.getAllByRole("checkbox")).toHaveLength(20);
    await userEvent.click(page.getByRole("button", { name: /Показать ещё/u }));
    await expect(page.getAllByRole("checkbox")).toHaveLength(40);
    await userEvent.type(
      page.getByRole("searchbox", { name: "Поиск: Продукты" }),
      "Агентная",
    );
    await expect(page.getAllByRole("checkbox")).toHaveLength(1);
    await expect(
      page.getByRole("list", { name: "Выбрано: Продукты" }),
    ).toHaveTextContent("Агентная разработка");
  },
};

export const BoundedMobile: Story = { ...mobile };
