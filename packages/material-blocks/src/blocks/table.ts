import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectArray, expectObject } from "../document-node.js";

export const tableBlock = defineMaterialBlock<"table">({
  children: (block) => block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.content)),
  kind: "table",
  mapChildren: (block, map) => ({
    ...block,
    rows: block.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({ ...cell, content: cell.content.map(map) })),
    })),
  }),
  render: (node, tools) => ({
    kind: "table",
    rows: expectArray(node.content, "table rows").map((rowValue) => {
      const row = expectObject(rowValue, "table row");
      if (row.type !== "tableRow") {
        throw new TypeError("Expected table row");
      }
      return {
        cells: expectArray(row.content, "table cells").map((cellValue) => {
          const cell = expectObject(cellValue, "table cell");
          if (cell.type !== "tableCell" && cell.type !== "tableHeader") {
            throw new TypeError("Expected table cell");
          }
          return { content: tools.blockContent(cell), header: cell.type === "tableHeader" };
        }),
      };
    }),
  }),
  renderedSchema: (block) =>
    z
      .object({
        kind: z.literal("table"),
        rows: z.array(
          z
            .object({
              cells: z.array(
                z.object({ content: z.array(block), header: z.boolean() }).strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
  text: (block, tools) =>
    block.rows
      .map((row) =>
        row.cells
          .map((cell) => cell.content.map(tools.blockText).filter(Boolean).join(" "))
          .join("\t"),
      )
      .join("\n"),
  type: "table",
});
