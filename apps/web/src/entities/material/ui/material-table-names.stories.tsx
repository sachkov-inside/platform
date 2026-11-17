import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

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
      exact: true,
    });
    await expect(region).toHaveAttribute("tabindex", "0");
    await expect(
      canvas.getByRole("table", { name: "Таблица в материале", exact: true }),
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
