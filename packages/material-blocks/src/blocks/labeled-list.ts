import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { nodeAttributes, optionalText } from "../document-node.js";
import { isJsonObject, isUnknownArray, isUnknownRecord } from "../json.js";
import { attributeText } from "./block-fields.js";

/**
 * Rows live in one attribute rather than in child nodes: a row is three short fields the author
 * fills in a form, and the document schema cannot declare a row node of its own.
 */
/** The stored shape of the attribute: an unset explanation is absent or `null`. */
const storedRowsSchema = z.array(
  z
    .object({
      description: z.string().nullish(),
      label: z.string(),
      name: z.string(),
    })
    .strict(),
);

/** The rendered shape: an unset explanation is absent, never `null`. */
const renderedRowSchema = z
  .object({
    description: z.string().optional(),
    label: z.string(),
    name: z.string(),
  })
  .strict();

/** Rows as the DOM carries them: one JSON attribute, written and read by the document schema. */
function renderedRows(value: unknown): readonly unknown[] {
  if (typeof value !== "string") {
    return isUnknownArray(value) ? value : [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isUnknownArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Terms of a lesson: a short label, the term it marks and an optional explanation. */
export const labeledListBlock = defineMaterialBlock<"labeled_list">({
  issues: (node, report) => {
    const rows = isJsonObject(node.attrs) ? node.attrs.rows : undefined;
    if (!storedRowsSchema.safeParse(rows).success) {
      report("invalid_labeled_rows", "rows");
    }
  },
  kind: "labeled_list",
  node: {
    atom: true,
    attributes: { rows: [] },
    // Rows are not a string, so they travel as JSON in their own attribute and survive a paste.
    domAttributes: { rows: "data-rows" },
    draggable: true,
    group: "block",
    parseHTML: ['[data-material-block="labeledList"]'],
    renderHTML: (attributes) => [
      "dl",
      { ...attributes, "data-material-block": "labeledList" },
      ...renderedRows(attributes["data-rows"]).flatMap((row) => {
        const parsed = isUnknownRecord(row) ? row : {};
        return [
          [
            "dt",
            {},
            `${attributeText(parsed.label)} ${attributeText(parsed.name)}`.trim(),
          ],
          ["dd", {}, attributeText(parsed.description)],
        ];
      }),
    ],
  },
  // The document already passed the field rule above, so a mismatch here is a defect and the
  // schema throws rather than repairing the row.
  render: (node) => ({
    kind: "labeled_list",
    rows: storedRowsSchema.parse(nodeAttributes(node).rows).map((row) => {
      const description = optionalText(row.description ?? undefined);
      return {
        ...(description === undefined ? {} : { description }),
        label: row.label,
        name: row.name,
      };
    }),
  }),
  renderedSchema: () =>
    z
      .object({ kind: z.literal("labeled_list"), rows: z.array(renderedRowSchema) })
      .strict(),
  text: (block) =>
    block.rows
      .map((row) => [row.label, row.name, row.description].filter(Boolean).join(" — "))
      .filter(Boolean)
      .join("\n"),
  type: "labeledList",
});
