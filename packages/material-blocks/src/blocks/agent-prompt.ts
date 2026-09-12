import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { nodeAttributes, optionalText } from "../document-node.js";
import { inlineText } from "../rendered-block.js";
import { optionalTitleIssue, titleAttributeSchema } from "./block-fields.js";

/**
 * A prompt the reader copies and runs. The body is verbatim text like a code block: newlines are
 * part of the prompt and formatting marks would change what the reader pastes.
 */
export const agentPromptBlock = defineMaterialBlock<"agent_prompt">({
  issues: (node, report) => {
    optionalTitleIssue(node, report, "invalid_agent_prompt_title");
  },
  kind: "agent_prompt",
  node: {
    attributes: { title: null },
    code: true,
    content: "text*",
    defining: true,
    group: "block",
    marks: "",
    parseContent: "[data-agent-prompt-body]",
    parseHTML: ['div[data-material-block="agentPrompt"]'],
    renderHTML: ({ title, ...attributes }) => [
      "div",
      { ...attributes, "data-material-block": "agentPrompt" },
      ["p", { "data-agent-prompt-title": "" }, typeof title === "string" ? title : ""],
      ["pre", { "data-agent-prompt-body": "" }, ["code", {}, 0]],
    ],
  },
  render: (node, tools) => {
    const title = optionalText(nodeAttributes(node).title);
    return {
      kind: "agent_prompt",
      text: inlineText(tools.inlineContent(node)),
      ...(title === undefined ? {} : { title }),
    };
  },
  renderedSchema: () =>
    z
      .object({
        kind: z.literal("agent_prompt"),
        text: z.string(),
        title: titleAttributeSchema,
      })
      .strict(),
  text: (block) => [block.title, block.text].filter(Boolean).join("\n\n"),
  type: "agentPrompt",
});
