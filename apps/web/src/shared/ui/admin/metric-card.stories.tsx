import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { MetricCard, type MetricCardProps } from "./metric-card.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const metrics: readonly (Omit<MetricCardProps, "selected" | "onSelect"> & {
  readonly id: string;
})[] = [
  {
    id: "revenue",
    label: "Выручка за вычетом возвратов",
    value: "148 700 ₽",
    period: "за 30 дней",
    change: {
      kind: "delta",
      text: "+24 950 ₽",
      direction: "up",
      meaning: "good",
    },
  },
  {
    id: "sales",
    label: "Продажи",
    value: "31",
    period: "за 30 дней",
    change: {
      kind: "delta",
      text: "+2 продажи",
      direction: "up",
      meaning: "good",
    },
  },
  {
    id: "refunds",
    label: "Возвраты",
    value: "3",
    period: "за 30 дней",
    change: {
      kind: "delta",
      text: "+1 возврат",
      direction: "up",
      meaning: "bad",
    },
  },
  {
    id: "accounts",
    label: "Новые аккаунты",
    value: "12",
    period: "за 30 дней",
    change: { kind: "delta", text: "0", direction: "flat", meaning: "neutral" },
  },
  {
    id: "waitlist",
    label: "Записи в списки ожидания",
    value: "5",
    period: "за 30 дней",
    change: { kind: "no_data" },
  },
];

/** Ряд показателей Обзора: щелчок по карточке переключает график. */
function MetricRow() {
  const [selected, setSelected] = useState("revenue");
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-3">
      {metrics.map(({ id, ...metric }) => (
        <MetricCard
          key={id}
          {...metric}
          onSelect={() => {
            setSelected(id);
          }}
          selected={selected === id}
        />
      ))}
    </div>
  );
}

const meta = {
  title: "Components/Админка/MetricCard",
  component: MetricCard,
  parameters: { layout: "padded" },
  args: {
    label: "Продажи",
    value: "1",
    period: "за 7 дней",
    change: {
      kind: "delta",
      text: "+1 продажа",
      direction: "up",
      meaning: "good",
    },
  },
} satisfies Meta<typeof MetricCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OverviewRowDesktop: Story = {
  ...desktop,
  render: () => <MetricRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const revenue = canvas.getByRole("button", { name: /^Выручка/u });
    const sales = canvas.getByRole("button", { name: /^Продажи/u });
    await expect(revenue).toHaveAttribute("aria-pressed", "true");
    await expect(sales).toHaveAttribute("aria-pressed", "false");
    // Высота карточки считает строки подписи. Первая история в холодном кадре мерила `before`
    // запасным шрифтом, а Manrope успевал загрузиться к `after` и переносил длинную подпись
    // (Application CI #1717, три прогона подряд 27.10). Раскладка запрашивает шрифты, оба замера
    // идут после их загрузки.
    sales.getBoundingClientRect();
    await canvasElement.ownerDocument.fonts.ready;
    const before = sales.getBoundingClientRect();
    await userEvent.click(sales);
    await expect(sales).toHaveAttribute("aria-pressed", "true");
    await expect(revenue).toHaveAttribute("aria-pressed", "false");
    const after = sales.getBoundingClientRect();
    await expect(after.height).toBe(before.height);
    await expect(after.width).toBe(before.width);
    await expect(
      canvas.getByRole("button", {
        name: /^Возвраты\s.*\+1 возврат\s?\(плохо\)/u,
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: /^Записи в списки ожидания.*нет данных/u,
      }),
    ).toBeVisible();
  },
};

export const OverviewRowMobile: Story = { ...OverviewRowDesktop, ...mobile };

/** Без обработчика карточка просто факт, не кнопка. */
export const StaticDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
  },
};

export const StaticMobile: Story = {
  ...mobile,
  args: { change: { kind: "no_data" } },
};

/** Число на сейчас с уточнением под значением: без периода и сравнения (#1719). */
export const WithDetailDesktop: Story = {
  ...desktop,
  args: {
    label: "Обладатели",
    value: "148",
    period: "сейчас",
    change: undefined,
    detail: "Покупка: 121 · Активация курса: 19 · Выдача владельцем: 6",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^Покупка: 121/u)).toBeVisible();
    await expect(canvas.queryByText("нет данных")).toBeNull();
  },
};

/** Источник не ответил: карточка говорит об этом, а не показывает ноль. */
export const UnavailableMobile: Story = {
  ...mobile,
  args: {
    label: "Выручка за вычетом возвратов",
    value: "Недоступно",
    unavailable: true,
    period: "за 30 дней",
    change: undefined,
    detail: "Не удалось посчитать, источник не ответил",
  },
};
