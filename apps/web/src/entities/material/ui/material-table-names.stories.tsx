import type { Meta, StoryObj } from "@storybook/react-vite";
import { renderedBlockSchema } from "@inside/material-blocks";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import type { RenderedBlock } from "../../material.model";
import { MaterialBodyView } from "./material-body-view";

function table(columns: number): Extract<RenderedBlock, { kind: "table" }> {
  return {
    kind: "table",
    rows: [
      {
        cells: Array.from({ length: columns }, (_, index) => ({
          header: true,
          content: [
            {
              kind: "paragraph",
              content: [
                { kind: "text", text: `Поле ${String(index + 1)}`, marks: [] },
              ],
            },
          ],
        })),
      },
    ],
  };
}

const inner = table(8);
const outer: Extract<RenderedBlock, { kind: "table" }> = {
  kind: "table",
  rows: [
    {
      cells: [
        { header: false, content: [inner] },
        {
          header: false,
          content: [
            {
              kind: "paragraph",
              content: [{ kind: "text", text: "Внешняя ячейка", marks: [] }],
            },
          ],
        },
        {
          header: false,
          content: [
            {
              kind: "paragraph",
              content: [{ kind: "text", text: "Ещё одна ячейка", marks: [] }],
            },
          ],
        },
      ],
    },
  ],
};

const meta = {
  title: "Components/Material/Table names",
  component: MaterialBodyView,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  args: {
    blocks: [inner],
    path: [],
    rendering: {
      headingId: (path: readonly number[]) => `table-names-${path.join("-")}`,
      image: () => null,
      file: () => null,
    },
  },
} satisfies Meta<typeof MaterialBodyView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SingleTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = canvas.getByRole("region", {
      name: "Таблица в материале",
    });
    await expect(region).toHaveAttribute("tabindex", "0");
    await expect(
      canvas.getByRole("table", { name: "Таблица в материале" }),
    ).toBeVisible();
    region.focus();
    await expect(region).toHaveFocus();
  },
};

export const NestedTables: Story = {
  args: { blocks: [outer, inner] },
  play: async ({ canvasElement }) => {
    const regions = within(canvasElement).getAllByRole("region");
    await expect(regions).toHaveLength(3);
    const tables = within(canvasElement).getAllByRole("table");
    await expect(tables).toHaveLength(3);
    for (const [index, name] of [
      "Таблица 1 в материале",
      "Таблица 2 в материале",
      "Таблица 3 в материале",
    ].entries()) {
      await expect(regions[index]).toHaveAccessibleName(name);
      await expect(tables[index]).toHaveAccessibleName(name);
    }
    const outerRegion = regions[0];
    const innerRegion = regions[1];
    if (outerRegion === undefined || innerRegion === undefined)
      throw new Error("Missing nested tables");
    for (const region of regions) {
      const frame = region.parentElement;
      if (frame === null) throw new Error("Missing table frame");
      await expect(region).toHaveAttribute("tabindex", "0");
      await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
      await waitFor(() =>
        expect(frame).toHaveAttribute("data-overflow", "end"),
      );
    }
    outerRegion.focus();
    await expect(outerRegion).toHaveFocus();
    outerRegion.scrollLeft = outerRegion.scrollWidth;
    await waitFor(() =>
      expect(outerRegion.parentElement).toHaveAttribute(
        "data-overflow",
        "start",
      ),
    );
    await expect(innerRegion.parentElement).toHaveAttribute(
      "data-overflow",
      "end",
    );
    innerRegion.focus();
    await expect(innerRegion).toHaveFocus();
    innerRegion.scrollLeft = innerRegion.scrollWidth;
    await waitFor(() =>
      expect(innerRegion.parentElement).toHaveAttribute(
        "data-overflow",
        "start",
      ),
    );
    await expect(outerRegion.parentElement).toHaveAttribute(
      "data-overflow",
      "start",
    );
  },
};

export const ReorderedDocument: Story = {
  args: { blocks: [outer, inner], blockOrder: [1, 0], path: [4, 2] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("region", {
      name: "Таблица 1 в материале",
    });
    const second = canvas.getByRole("region", {
      name: "Таблица 2 в материале",
    });
    const third = canvas.getByRole("region", {
      name: "Таблица 3 в материале",
    });
    await expect(canvas.getAllByRole("region")).toEqual([first, second, third]);
    await expect(within(first).getAllByRole("table")).toHaveLength(1);
    await expect(within(second).getAllByRole("table")).toHaveLength(2);
    await expect(second).toContainElement(third);
    for (const [index, item] of canvas.getAllByRole("table").entries())
      await expect(item).toHaveAccessibleName(
        `Таблица ${String(index + 1)} в материале`,
      );
  },
};

function ChangingDocument() {
  const [multiple, setMultiple] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMultiple((value) => !value);
        }}
      >
        Изменить документ
      </button>
      <MaterialBodyView
        {...meta.args}
        blocks={multiple ? [inner, outer] : [inner]}
      />
    </>
  );
}

export const UpdatedDocument: Story = {
  render: () => <ChangingDocument />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("region", {
      name: "Таблица в материале",
    });
    const firstTable = canvas.getByRole("table", {
      name: "Таблица в материале",
    });
    await document.fonts.ready;
    const geometry = first.getBoundingClientRect();
    await userEvent.click(
      canvas.getByRole("button", { name: "Изменить документ" }),
    );
    await expect(canvas.getAllByRole("region")).toHaveLength(3);
    await expect(
      canvas.getByRole("region", {
        name: "Таблица 1 в материале",
      }),
    ).toBe(first);
    await expect(
      canvas.getByRole("table", { name: "Таблица 1 в материале" }),
    ).toBe(firstTable);
    await expect(first.getBoundingClientRect().width).toBe(geometry.width);
    await expect(first.getBoundingClientRect().height).toBe(geometry.height);
    first.focus();
    await expect(first).toHaveFocus();
    await userEvent.click(
      canvas.getByRole("button", { name: "Изменить документ" }),
    );
    await expect(canvas.getAllByRole("region")).toHaveLength(1);
    await expect(
      canvas.getByRole("region", { name: "Таблица в материале" }),
    ).toBe(first);
    await expect(
      canvas.getByRole("table", { name: "Таблица в материале" }),
    ).toBe(firstTable);
  },
};

export const SingleAfterEmptyComparison: Story = {
  args: { blocks: [inner, inner], comparison: { at: 0, labels: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("region")).toHaveLength(1);
    await expect(canvas.getByRole("region")).toHaveAccessibleName(
      "Таблица в материале",
    );
    await expect(canvas.getByRole("table")).toHaveAccessibleName(
      "Таблица в материале",
    );
  },
};

export const TablesInComparedContent: Story = {
  args: {
    blocks: [
      { kind: "callout", title: "Модель A", tone: "note", content: [outer] },
      inner,
      inner,
    ],
    comparison: { at: 0, labels: ["A", "Пропущенная карточка"] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const regions = canvas.getAllByRole("region", { name: /^Таблица /u });
    await expect(regions).toHaveLength(3);
    const tables = canvas.getAllByRole("table");
    for (const [index, name] of [
      "Таблица 1 в материале",
      "Таблица 2 в материале",
      "Таблица 3 в материале",
    ].entries()) {
      await expect(regions[index]).toHaveAccessibleName(name);
      await expect(tables[index]).toHaveAccessibleName(name);
    }
    await expect(canvas.getAllByRole("button")).toHaveLength(1);
  },
};

const orderLabels = ["Подготовить", "Вычислить", "Проверить результат"];
const orderExercise = renderedBlockSchema.parse({
  kind: "order",
  id: "table-reading-order",
  reveal: "none",
  question: [
    {
      kind: "paragraph",
      content: [{ kind: "text", text: "Расставь шаги по порядку.", marks: [] }],
    },
  ],
  steps: orderLabels.map((label, index) => ({
    id: `step-${String(index + 1)}`,
    content: [
      {
        kind: "paragraph",
        content: [{ kind: "text", text: label, marks: [] }],
      },
      table(2),
    ],
    explanation: [
      {
        kind: "paragraph",
        content: [{ kind: "text", text: `Разбор: ${label}`, marks: [] }],
      },
    ],
  })),
});

export const OrderStepTablesFollowShownOrder: Story = {
  args: { blocks: [orderExercise] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const regions = canvas.getAllByRole("region", { name: /^Таблица /u });
    await expect(regions).toHaveLength(3);
    for (const [index, item] of regions.entries())
      await expect(item).toHaveAccessibleName(
        `Таблица ${String(index + 1)} в материале`,
      );
    const first = regions[0];
    const second = regions[1];
    const third = regions[2];
    const firstStep = first?.closest<HTMLElement>("[data-order-step]");
    if (firstStep === null || firstStep === undefined)
      throw new Error("Missing shown first step");
    await userEvent.click(
      within(firstStep).getByRole("button", { name: /^Ниже /u }),
    );
    await expect(canvas.getAllByRole("region", { name: /^Таблица /u })).toEqual(
      [second, first, third],
    );
    await expect(second).toHaveAccessibleName("Таблица 1 в материале");
    await expect(first).toHaveAccessibleName("Таблица 2 в материале");
    await waitFor(() =>
      expect(
        within(firstStep).getByRole("button", { name: /^Ниже /u }),
      ).toHaveFocus(),
    );
    for (const [target, label] of orderLabels.entries()) {
      const step = canvas
        .getByText(label, { exact: true })
        .closest<HTMLElement>("[data-order-step]");
      if (step === null) throw new Error("Missing named step");
      for (let move = 0; move < 3; move++) {
        const position = Array.from(
          canvasElement.querySelectorAll("[data-order-step]"),
        ).indexOf(step);
        if (position === target) break;
        await userEvent.click(
          within(step).getByRole("button", { name: /^Выше /u }),
        );
      }
    }
    for (const [index, item] of canvas.getAllByRole("table").entries())
      await expect(item).toHaveAccessibleName(
        `Таблица ${String(index + 1)} в материале`,
      );
    await userEvent.click(canvas.getByRole("button", { name: "Проверить" }));
    await expect(canvas.getByText("Правильно", { exact: true })).toBeVisible();
  },
};
