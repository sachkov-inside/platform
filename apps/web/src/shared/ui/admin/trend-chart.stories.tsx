import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { formatRubles } from "@/shared/lib/moscow-format";

import { TrendChart, type TrendPoint } from "./trend-chart.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

/** Дни периода, заканчивающегося 24 октября 2026: без текущих часов. */
function days(count: number, endDay = Date.UTC(2026, 9, 24)): string[] {
  return Array.from({ length: count }, (_, index) =>
    new Date(endDay - (count - 1 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}

function series(values: readonly number[], endDay?: number): TrendPoint[] {
  const dates = days(values.length, endDay);
  return values.map((value, index) => ({
    date: dates[index] ?? "2026-10-24",
    value,
  }));
}

const revenue = [
  0, 499_000, 499_000, 0, 998_000, 0, 0, 499_000, 1_497_000, 499_000, 0,
  499_000, 0, 0, 998_000, 499_000, 0, 499_000, 499_000, 0, 1_996_000, 0,
  499_000, 0, 499_000, 998_000, 0, 499_000, 0, 499_000,
];
const previousRevenue = [
  0, 0, 499_000, 0, 0, 499_000, 0, 0, 499_000, 0, 120_000, 0, 499_000, 0, 0, 0,
  499_000, 0, 0, 998_000, 0, 0, 499_000, 0, 0, 499_000, 0, 0, 0, 499_000,
];

const meta = {
  title: "Components/Админка/TrendChart",
  component: TrendChart,
  parameters: { layout: "padded" },
  args: {
    title: "Выручка по дням",
    summary:
      "За 30 дней 148 700 ₽, на 24 950 ₽ больше прошлого периода. Больше всего 14 октября: 19 960 ₽.",
    points: series(revenue),
    previous: series(previousRevenue, Date.UTC(2026, 8, 24)),
    formatValue: formatRubles,
    emptyTitle: "Продаж за период ещё не было",
    emptyDescription:
      "График появится после первой оплаты. Создайте ссылку на оплату или откройте продажи продукта.",
  },
} satisfies Meta<typeof TrendChart>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ThirtyDaysDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const plot = canvas.getByRole("group", { name: /^Выручка по дням/u });
    await expect(plot).toHaveAttribute("tabindex", "0");
    const readout = canvasElement.querySelector(".admin-trend-readout");
    await expect(readout).toHaveTextContent(
      "24 окт: 4 990 ₽ (прошлый период: 4 990 ₽)",
    );
    await userEvent.tab();
    await expect(plot).toHaveFocus();
    await expect(
      canvasElement.querySelector('.admin-trend-dot[data-series="current"]'),
    ).not.toBeNull();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(readout).toHaveTextContent(
      "23 окт: 0 ₽ (прошлый период: 0 ₽)",
    );
    await userEvent.keyboard("{Home}");
    await expect(readout).toHaveTextContent("25 сент: 0 ₽");
    await userEvent.keyboard("{End}");
    await expect(readout).toHaveTextContent("24 окт: 4 990 ₽");
    const table = canvas.getByRole("table", { name: "Выручка по дням" });
    await expect(within(table).getAllByRole("row")).toHaveLength(31);
  },
};

export const ThirtyDaysMobile: Story = {
  ...mobile,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    );
    const labels = [
      ...canvasElement.querySelectorAll<HTMLElement>(
        ".admin-trend-x-axis span",
      ),
    ].filter((label) => label.getBoundingClientRect().width > 0);
    for (const [index, label] of labels.entries()) {
      const next = labels[index + 1];
      if (next === undefined) continue;
      await expect(label.getBoundingClientRect().right).toBeLessThan(
        next.getBoundingClientRect().left,
      );
    }
  },
};

export const TwoPointsDesktop: Story = {
  ...desktop,
  args: {
    summary: "Две продажи за 2 дня.",
    points: series([499_000, 998_000]),
    previous: [],
  },
};

export const OnePointMobile: Story = {
  ...mobile,
  args: {
    title: "Продажи по дням",
    summary: "Одна продажа сегодня.",
    points: series([1]),
    previous: [],
    formatValue: (value) => String(value),
  },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector('.admin-trend-dot[data-series="single"]'),
    ).not.toBeNull();
  },
};

/** Почти одни нули и один выброс: шкала не дробится, линия не уходит за поле. */
export const SparseSpikyDesktop: Story = {
  ...desktop,
  args: {
    title: "Продажи по дням",
    summary: "За 30 дней 9 продаж, все 14 октября после рассылки.",
    points: series(Array.from({ length: 30 }, (_, i) => (i === 19 ? 9 : 0))),
    previous: series(
      Array.from({ length: 30 }, (_, i) => (i === 3 ? 1 : 0)),
      Date.UTC(2026, 8, 24),
    ),
    formatValue: (value) => String(value),
  },
};

export const SparseSpikyMobile: Story = { ...SparseSpikyDesktop, ...mobile };

/**
 * Выручка за вычетом возвратов, где в один день были только возвраты: линия уходит ниже нуля, а
 * нулевая линия остаётся на оси (#1719).
 */
export const NegativeDayDesktop: Story = {
  ...desktop,
  args: {
    title: "Выручка за вычетом возвратов",
    summary: "За 7 дней: 24 980 ₽. 21 октября только возврат: \u22124 990 ₽.",
    points: series([1_249_000, 0, 0, -499_000, 0, 1_249_000, 499_000]),
    previous: series([0, 499_000, 0, 0, 0, 0, 499_000], Date.UTC(2026, 9, 17)),
    formatValue: formatRubles,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^[-\u2212]5\s000\s₽$/u)).toBeInTheDocument();
    const plot = canvas.getByRole("group");
    const box = plot.getBoundingClientRect();
    const line = canvasElement.querySelector(
      "svg polyline.admin-trend-current",
    );
    const lowest = line?.getBoundingClientRect();
    // Линия целиком внутри поля графика: отрицательный день не уходит под ось.
    await expect(lowest?.bottom ?? Infinity).toBeLessThanOrEqual(
      box.bottom + 1,
    );
  },
};

export const NegativeDayMobile: Story = { ...NegativeDayDesktop, ...mobile };

/** Нет данных: пустое состояние вместо плоской линии и без фокусируемого поля. */
export const EmptyDesktop: Story = {
  ...desktop,
  args: {
    summary: "За 30 дней оплат не было.",
    points: series(Array.from({ length: 30 }, () => 0)),
    previous: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Продаж за период ещё не было"),
    ).toBeVisible();
    await expect(canvas.queryByRole("group")).toBeNull();
    await expect(canvasElement.querySelector("svg polyline")).toBeNull();
  },
};

export const EmptyMobile: Story = {
  ...EmptyDesktop,
  ...mobile,
  args: { ...EmptyDesktop.args, points: [] },
};
