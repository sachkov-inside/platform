import { z } from "zod";

import {
  defineMaterialBlock,
  type MaterialBlockDefinition,
} from "../block-definition.js";
import { nodeAttributes } from "../document-node.js";
import { inlineText } from "../rendered-block.js";

/** The fence info string names the language; an empty one leaves the code plain. */
function codeLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const language = value.trim();
  return language === "" ? undefined : language;
}

export const codeBlock: MaterialBlockDefinition =
  defineMaterialBlock<"code_block">({
    kind: "code_block",
    render: (node, tools) => {
      const language = codeLanguage(nodeAttributes(node)["language"]);
      return {
        kind: "code_block",
        ...(language === undefined ? {} : { language }),
        text: inlineText(tools.inlineContent(node)),
      };
    },
    renderedSchema: () =>
      z
        .object({
          kind: z.literal("code_block"),
          language: z.string().min(1).optional(),
          text: z.string(),
        })
        .strict(),
    text: (block) => block.text,
    type: "codeBlock",
  });
