import { z } from "zod";

import {
  defineMaterialBlock,
  type MaterialBlockDefinition,
} from "../block-definition.js";
import { attributeText } from "./block-fields.js";
import { expectString, nodeAttributes } from "../document-node.js";
import { glossaryTermIdSchema } from "../glossary-term-id.js";
import { stringAttribute } from "../json.js";

/**
 * A definition card, `> [!definition] term:<id>` in Markdown. The body stores only the term: the
 * reader takes the full definition from the Glossary when it opens the Material, so a corrected
 * definition reaches every Material without republishing it.
 */
export const termDefinitionBlock: MaterialBlockDefinition =
  defineMaterialBlock<"term_definition">({
    issues: (node, report) => {
      const termId = stringAttribute(node, "termId");
      if (
        termId === undefined ||
        !glossaryTermIdSchema.safeParse(termId).success
      ) {
        report("invalid_term_id", "termId");
      }
    },
    kind: "term_definition",
    node: {
      atom: true,
      attributes: { termId: null },
      domAttributes: { termId: "data-term-id" },
      draggable: true,
      group: "block",
      parseHTML: ['[data-material-block="termDefinition"]'],
      renderHTML: (attributes) => [
        "div",
        { ...attributes, "data-material-block": "termDefinition" },
        `Определение: ${attributeText(attributes["data-term-id"])}`,
      ],
    },
    render: (node) => ({
      kind: "term_definition",
      termId: expectString(nodeAttributes(node)["termId"], "term identifier"),
    }),
    renderedSchema: () =>
      z
        .object({
          kind: z.literal("term_definition"),
          termId: glossaryTermIdSchema,
        })
        .strict(),
    text: () => "",
    type: "termDefinition",
  });
