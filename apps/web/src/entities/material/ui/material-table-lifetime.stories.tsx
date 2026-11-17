import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import type { RenderedBlock } from "../../material.model";
import { MaterialBodyView } from "./material-body-view";

function tableBlock(
  columns: number,
): Extract<RenderedBlock, { kind: "table" }> {
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
                { kind: "text", text: `Поле${String(index + 1)}`, marks: [] },
              ],
            },
          ],
        })),
      },
    ],
  };
}

const rendering = {
  headingId: (path: readonly number[]) => `table-section-${path.join("-")}`,
  image: () => null,
  file: () => null,
};

function TableLifetime({
  initialColumns = 8,
}: {
  readonly initialColumns?: number;
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setColumns((count) => (count === 2 ? 8 : 2));
        }}
      >
        Изменить столбцы
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible((value) => !value);
        }}
      >
        Скрыть или вернуть таблицу
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Удалить таблицу
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <MaterialBodyView
            blocks={[tableBlock(columns)]}
            path={[]}
            rendering={rendering}
          />
        ) : null}
      </Activity>
    </>
  );
}

const meta = {
  title: "Components/Material/Table lifetime",
  component: TableLifetime,
  globals: { viewport: { value: "mobile390", isRotated: false } },
} satisfies Meta<typeof TableLifetime>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RetainsTableViewport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scroller = canvas.getByRole("region", {
      name: "Таблица в материале",
    });
    const frame = scroller.parentElement;
    if (frame === null) throw new Error("Missing table frame");
    await expect(scroller).toBeVisible();
    await expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    await waitFor(() => expect(frame).toHaveAttribute("data-overflow", "end"));
    scroller.focus();
    await expect(scroller).toHaveFocus();
    scroller.scrollLeft = scroller.scrollWidth;
    await waitFor(() =>
      expect(frame).toHaveAttribute("data-overflow", "start"),
    );
    const savedLeft = scroller.scrollLeft;
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть или вернуть таблицу" }),
    );
    await waitFor(() => expect(scroller).not.toBeVisible());
    await expect(scroller.isConnected).toBe(true);
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть или вернуть таблицу" }),
    );
    await waitFor(() => expect(scroller).toBeVisible());
    await expect(
      canvas.getByRole("region", { name: "Таблица в материале" }),
    ).toBe(scroller);
    await expect(scroller.scrollLeft).toBe(savedLeft);
    await waitFor(() =>
      expect(frame).toHaveAttribute("data-overflow", "start"),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить таблицу" }),
    );
    await waitFor(() => expect(scroller.isConnected).toBe(false));
  },
};

export const TracksContentWidthWithoutViewportResize: Story = {
  args: { initialColumns: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scroller = canvas.getByRole("region", {
      name: "Таблица в материале",
    });
    const frame = scroller.parentElement;
    const table = scroller.querySelector("table");
    if (frame === null || table === null)
      throw new Error("Missing rendered table");
    await document.fonts.ready;
    const geometry = () => ({
      clientWidth: scroller.clientWidth,
      clientHeight: scroller.clientHeight,
      scrollWidth: scroller.scrollWidth,
      contentWidth: table.getBoundingClientRect().width,
      contentHeight: table.getBoundingClientRect().height,
      fonts: document.fonts.status,
      connected: scroller.isConnected,
    });
    await expect(scroller.scrollWidth).toBeLessThanOrEqual(
      scroller.clientWidth,
    );
    await waitFor(() => expect(frame).toHaveAttribute("data-overflow", "none"));
    const initial = geometry();
    await userEvent.click(
      canvas.getByRole("button", { name: "Изменить столбцы" }),
    );
    await waitFor(() =>
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth),
    );
    await expect(scroller.querySelector("table")).toBe(table);
    await expect(scroller.clientWidth).toBe(initial.clientWidth);
    await expect(scroller.clientHeight).toBe(initial.clientHeight);
    console.info(
      "TABLE_WIDTH_DIAG",
      JSON.stringify({ initial, now: geometry() }),
    );
    await waitFor(() =>
      expect(
        frame,
        JSON.stringify({ initial, now: geometry() }),
      ).toHaveAttribute("data-overflow", "end"),
    );
    const fade = frame.querySelector("[data-table-fade='end']");
    if (fade === null) throw new Error("Missing table end fade");
    await waitFor(() => expect(getComputedStyle(fade).opacity).toBe("1"));
    const grown = geometry();
    await userEvent.click(
      canvas.getByRole("button", { name: "Изменить столбцы" }),
    );
    await waitFor(() =>
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth),
    );
    await expect(scroller.clientWidth).toBe(initial.clientWidth);
    await expect(scroller.clientHeight).toBe(initial.clientHeight);
    console.info(
      "TABLE_WIDTH_DIAG",
      JSON.stringify({ initial, grown, now: geometry() }),
    );
    await waitFor(() =>
      expect(
        frame,
        JSON.stringify({ initial, grown, now: geometry() }),
      ).toHaveAttribute("data-overflow", "none"),
    );
    await waitFor(() => expect(getComputedStyle(fade).opacity).toBe("0"));
  },
};
