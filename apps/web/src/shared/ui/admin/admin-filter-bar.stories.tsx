import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { formatCountRu } from "@/shared/lib/moscow-format";

import {
  AdminFilterBar,
  type AdminFilterChip,
  type AdminSelectFilter,
} from "./admin-filter-bar.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const topicOptions = [
  { value: "all", label: "Все темы" },
  { value: "ai", label: "AI Engineering" },
  { value: "agents", label: "Разработка с агентами" },
  { value: "architecture", label: "Архитектура и проектирование систем" },
];
const formatOptions = [
  { value: "all", label: "Все форматы" },
  { value: "guide", label: "Гайд" },
  { value: "video", label: "Видео" },
  { value: "note", label: "Заметка" },
];
const stateOptions = [
  { value: "all", label: "Все состояния" },
  { value: "draft", label: "Черновик" },
  { value: "published", label: "Опубликован" },
];

const counts = { all: 112, filtered: 12 } as const;
const topicChanged = fn();

/** Страница владеет состоянием фильтров (в продукте адресом); модуль только показывает его. */
function MaterialsFilters({
  filterCount,
  initial,
}: {
  readonly filterCount: 1 | 2 | 3;
  readonly initial?: { readonly topic?: string; readonly format?: string };
}) {
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState(initial?.topic ?? "all");
  const [format, setFormat] = useState(initial?.format ?? "all");
  const [state, setState] = useState("all");
  const allFilters: AdminSelectFilter[] = [
    {
      id: "topic",
      label: "Тема",
      value: topic,
      options: topicOptions,
      onChange: (value) => {
        topicChanged(value);
        setTopic(value);
      },
    },
    {
      id: "format",
      label: "Формат",
      value: format,
      options: formatOptions,
      onChange: setFormat,
    },
    {
      id: "state",
      label: "Состояние публикации",
      value: state,
      options: stateOptions,
      onChange: setState,
    },
  ];
  const filters = allFilters.slice(0, filterCount);
  const chips: AdminFilterChip[] = [];
  const topicLabel = topicOptions.find((option) => option.value === topic);
  if (topic !== "all" && topicLabel !== undefined)
    chips.push({
      id: "topic",
      label: topicLabel.label,
      onRemove: () => {
        setTopic("all");
      },
    });
  const formatLabel = formatOptions.find((option) => option.value === format);
  if (format !== "all" && formatLabel !== undefined)
    chips.push({
      id: "format",
      label: formatLabel.label,
      onRemove: () => {
        setFormat("all");
      },
    });
  const filtered = chips.length > 0 || search !== "";
  return (
    <AdminFilterBar
      chips={chips}
      filters={filters}
      onReset={
        filtered
          ? () => {
              setSearch("");
              setTopic("all");
              setFormat("all");
              setState("all");
            }
          : undefined
      }
      resultLabel={formatCountRu(filtered ? counts.filtered : counts.all, [
        "материал",
        "материала",
        "материалов",
      ])}
      search={{
        label: "Поиск по материалам",
        placeholder: "Название или фрагмент описания",
        value: search,
        onChange: setSearch,
        maxLength: 120,
      }}
    />
  );
}

const meta = {
  title: "Components/Админка/AdminFilterBar",
  component: AdminFilterBar,
  parameters: { layout: "padded" },
  args: { filters: [], chips: [] },
  beforeEach: () => {
    topicChanged.mockClear();
  },
} satisfies Meta<typeof AdminFilterBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MaterialsDesktop: Story = {
  ...desktop,
  render: () => <MaterialsFilters filterCount={2} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole("searchbox", {
      name: "Поиск по материалам",
    });
    const topic = canvas.getByRole("combobox", { name: "Тема" });
    const format = canvas.getByRole("combobox", { name: "Формат" });
    // Одна строка на компьютере: поиск и выборы на одной высоте.
    const top = search.getBoundingClientRect().top;
    await expect(
      Math.abs(topic.getBoundingClientRect().top - top),
    ).toBeLessThan(4);
    await expect(
      Math.abs(format.getBoundingClientRect().top - top),
    ).toBeLessThan(4);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "112 материалов",
    );

    await userEvent.click(topic);
    await userEvent.click(
      await within(document.body).findByRole("option", {
        name: "Разработка с агентами",
      }),
    );
    await expect(topicChanged).toHaveBeenCalledWith("agents");
    // Radix Select на время закрытия запрещает указатель на странице.
    await waitFor(() =>
      expect(document.body.style.pointerEvents).not.toBe("none"),
    );
    const chips = canvas.getByRole("list", { name: "Применённые фильтры" });
    await expect(
      within(chips).getByText("Разработка с агентами"),
    ).toBeVisible();
    await expect(canvas.getByRole("status")).toHaveTextContent("12 материалов");

    await userEvent.click(
      canvas.getByRole("button", {
        name: "Убрать фильтр «Разработка с агентами»",
      }),
    );
    await expect(
      canvas.queryByRole("list", { name: "Применённые фильтры" }),
    ).toBeNull();
    await expect(topic).toHaveTextContent("Все темы");

    await userEvent.type(search, "агент");
    await userEvent.click(canvas.getByRole("button", { name: "Сбросить" }));
    await expect(search).toHaveValue("");
    await expect(canvas.queryByRole("button", { name: "Сбросить" })).toBeNull();
  },
};

export const MaterialsMobile: Story = {
  ...mobile,
  render: () => (
    <MaterialsFilters
      filterCount={3}
      initial={{ topic: "architecture", format: "guide" }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole("searchbox", {
      name: "Поиск по материалам",
    });
    await expect(Math.round(search.getBoundingClientRect().width)).toBe(
      Math.round(
        canvasElement
          .querySelector(".admin-filter-bar")
          ?.getBoundingClientRect().width ?? 0,
      ),
    );
    for (const button of canvas.getAllByRole("button"))
      await expect(
        button.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(40);
    await expect(
      canvas.getByRole("button", {
        name: "Убрать фильтр «Архитектура и проектирование систем»",
      }),
    ).toBeVisible();
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    );
  },
};

/** Фильтр по умолчанию («Без комментария» у сдач) виден плашкой, но не убирается. */
export const DefaultChipDesktop: Story = {
  ...desktop,
  args: {
    filters: [
      {
        id: "state",
        label: "Состояние сдачи",
        value: "awaiting",
        options: [
          { value: "all", label: "Все сдачи" },
          { value: "awaiting", label: "Без комментария" },
          { value: "commented", label: "Прокомментированные" },
        ],
        onChange: fn(),
      },
    ],
    chips: [{ id: "state", label: "Без комментария" }],
    resultLabel: "3 сдачи",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Без комментария", { selector: "li" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /Убрать фильтр/u }),
    ).toBeNull();
  },
};

export const DefaultChipMobile: Story = { ...DefaultChipDesktop, ...mobile };
