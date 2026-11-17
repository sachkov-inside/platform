import type { Meta, StoryObj } from "@storybook/react-vite";
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
