import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { nodeAttributes, optionalText } from "../document-node.js";
import { isJsonArray, isJsonObject, isUnknownArray, isUnknownRecord } from "../json.js";
import type { JsonValue } from "../json.js";
import type { MaterialLabeledRow } from "../rendered-block.js";

/**
 * Rows live in one attribute rather than in child nodes: a row is three short fields the author
 * fills in a form, and the document schema cannot declare a row node of its own.
 */
const MAX_ROWS = 50;

const rowSchema = z
  .object({
    description: z.string().optional(),
    label: z.string(),
    name: z.string(),
  })
  .strict();

function acceptedRow(value: JsonValue): boolean {
  if (!isJsonObject(value)) return false;
  const { description, label, name, ...rest } = value;
  if (Object.keys(rest).length > 0) return false;
  if (typeof label !== "string" || typeof name !== "string") return false;
  return (
    description === undefined || description === null || typeof description === "string"
  );
}

function readRows(value: JsonValue | undefined): readonly MaterialLabeledRow[] {
  if (value === undefined || !isJsonArray(value)) {
    throw new TypeError("Expected labeled list rows");
  }
  return value.map((row) => {
    if (!isJsonObject(row)) {
      throw new TypeError("Expected labeled list row");
    }
    const description = optionalText(row.description);
    return {
      ...(description === undefined ? {} : { description }),
      label: typeof row.label === "string" ? row.label : "",
      name: typeof row.name === "string" ? row.name : "",
    };
  });
}

/** Terms of a lesson: a short label, the term it marks and an optional explanation. */
export const labeledListBlock = defineMaterialBlock<"labeled_list">({
  issues: (node, report) => {
    const rows = isJsonObject(node.attrs) ? node.attrs.rows : undefined;
    if (
      rows === undefined ||
      !isJsonArray(rows) ||
      rows.length > MAX_ROWS ||
      !rows.every(acceptedRow)
    ) {
      report("invalid_labeled_rows", "rows");
    }
  },
  kind: "labeled_list",
  node: {
    atom: true,
    attributes: { rows: [] },
    draggable: true,
    group: "block",
    parseHTML: ['[data-material-block="labeledList"]'],
    renderHTML: ({ rows, ...attributes }) => [
      "dl",
      { ...attributes, "data-material-block": "labeledList" },
      ...(isUnknownArray(rows) ? rows : []).flatMap((row) => {
        const parsed = isUnknownRecord(row) ? row : {};
        const text = (value: unknown) => (typeof value === "string" ? value : "");
        return [
          ["dt", {}, `${text(parsed.label)} ${text(parsed.name)}`.trim()],
          ["dd", {}, text(parsed.description)],
        ];
      }),
    ],
  },
  render: (node) => ({
    kind: "labeled_list",
    rows: readRows(nodeAttributes(node).rows),
  }),
  renderedSchema: () =>
    z.object({ kind: z.literal("labeled_list"), rows: z.array(rowSchema) }).strict(),
  text: (block) =>
    block.rows
      .map((row) => [row.label, row.name, row.description].filter(Boolean).join(" — "))
      .filter(Boolean)
      .join("\n"),
  type: "labeledList",
});
