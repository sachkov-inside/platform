import { z } from "zod";

import {
  defineMaterialBlock,
  type MaterialBlockDefinition,
} from "../block-definition.js";
import { attributeText } from "./block-fields.js";
import { expectString, nodeAttributes } from "../document-node.js";
import { stringAttribute } from "../json.js";

const labelSchema = z
  .string()
  .refine(
    (value) => value.length > 0 && value.trim() === value,
    "Expected a trimmed nonblank label",
  );

/**
 * A Lesson Step Break, `> [!next] <label>` in Content: the next part of the lesson opens by a
 * button with this label. Content places it (#87); the reader shows parts one by one (#2122).
 * It has no author id: parts are ordinal.
 */
export const stepBreakBlock: MaterialBlockDefinition =
  defineMaterialBlock<"step_break">({
    issues: (node, report) => {
      const label = stringAttribute(node, "label");
      if (label === undefined || !labelSchema.safeParse(label).success)
        report("invalid_step_break_label", "label");
    },
    kind: "step_break",
    node: {
      atom: true,
      attributes: { label: null },
      domAttributes: { label: "data-label" },
      group: "block",
      parseHTML: ['[data-material-block="stepBreak"]'],
      renderHTML: (attributes) => [
        "div",
        { ...attributes, "data-material-block": "stepBreak" },
        `Переход: ${attributeText(attributes["data-label"])}`,
      ],
    },
    render: (node) => ({
      kind: "step_break",
      label: expectString(nodeAttributes(node)["label"], "step break label"),
    }),
    renderedSchema: () =>
      z.object({ kind: z.literal("step_break"), label: labelSchema }).strict(),
    // The label is a button, not lesson text.
    text: () => "",
    type: "stepBreak",
  });
