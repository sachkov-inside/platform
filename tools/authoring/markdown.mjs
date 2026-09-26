import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import {
  addressableMaterialBlockTypes,
  calloutToneLabels,
} from "@inside/material-blocks";
import MarkdownIt from "markdown-it";
import { createHash } from "node:crypto";

const parser = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
});
const calloutHeader = /^>\s*\[!([a-z-]+)\][+-]?(?:\s+(.*))?$/u;
parser.block.ruler.before(
  "blockquote",
  "inside_callout",
  (state, start, end, silent) => {
    const first = state.src.slice(
      state.bMarks[start] + state.tShift[start],
      state.eMarks[start],
    );
    const match = calloutHeader.exec(first);
    if (match === null) return false;
    if (silent) return true;
    const lines = [];
    let fence = null;
    let next = start + 1;
    for (; next < end; next += 1) {
      const line = state.src.slice(
        state.bMarks[next] + state.tShift[next],
        state.eMarks[next],
      );
      if (!line.startsWith(">") || (fence === null && calloutHeader.test(line)))
        break;
      const content = line.replace(/^> ?/u, "");
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(content);
      if (fence === null) {
        if (marker && (marker[1][0] !== "`" || !marker[2].includes("`")))
          fence = marker[1];
      } else if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        /^\s*$/u.test(marker[2])
      ) {
        fence = null;
      }
      lines.push(content);
    }
    const token = state.push("inside_callout", "", 0);
    token.map = [start, next];
    token.meta = {
      kind: match[1],
      title: match[2] ?? null,
      content: lines.join("\n"),
    };
    state.line = next;
    return true;
  },
);

export function sourceUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function convertMarkdown(
  markdown,
  { sourcePath, sourceId, link, image },
) {
  const fail = (token, message) => {
    throw new Error(`${sourcePath}:${(token.map?.[0] ?? 0) + 1}: ${message}`);
  };
  const inline = (tokens, parent) => {
    const nodes = [];
    const marks = [];
    for (const token of tokens ?? []) {
      if (["text", "code_inline"].includes(token.type)) {
        if (token.content.length)
          nodes.push({
            type: "text",
            text: token.content,
            ...(marks.length || token.type === "code_inline"
              ? {
                  marks: [
                    ...marks,
                    ...(token.type === "code_inline" ? [{ type: "code" }] : []),
                  ],
                }
              : {}),
          });
      } else if (token.type === "softbreak") {
        nodes.push({
          type: "text",
          text: "\n",
          ...(marks.length ? { marks: [...marks] } : {}),
        });
      } else if (token.type === "hardbreak") nodes.push({ type: "hardBreak" });
      else if (["strong_open", "em_open", "s_open"].includes(token.type))
        marks.push({
          type: { strong_open: "bold", em_open: "italic", s_open: "strike" }[
            token.type
          ],
        });
      else if (token.type === "link_open")
        marks.push({
          type: "link",
          attrs: { href: link(token.attrGet("href")) },
        });
      else if (
        ["strong_close", "em_close", "s_close", "link_close"].includes(
          token.type,
        )
      )
        marks.pop();
      else if (token.type === "image") {
        if (marks.length)
          fail(
            parent,
            "linked/marked image requires an explicit supported block",
          );
        nodes.push({
          type: "assetImage",
          attrs: {
            assetId: image(token.attrGet("src")),
            alt: token.content,
            caption: token.attrGet("title"),
          },
        });
      } else fail(parent, `unsupported inline Markdown: ${token.type}`);
    }
    return nodes;
  };
  const blocks = (tokens) => {
    const root = { type: "doc", content: [] };
    const stack = [root];
    const append = (node) => stack.at(-1).content.push(node);
    for (const token of tokens) {
      const types = {
        paragraph_open: "paragraph",
        heading_open: "heading",
        blockquote_open: "blockquote",
        bullet_list_open: "bulletList",
        ordered_list_open: "orderedList",
        list_item_open: "listItem",
        table_open: "table",
        tr_open: "tableRow",
        th_open: "tableHeader",
        td_open: "tableCell",
      };
      if (
        ["thead_open", "thead_close", "tbody_open", "tbody_close"].includes(
          token.type,
        )
      )
        continue;
      if (token.type in types) {
        const node = { type: types[token.type], content: [] };
        if (token.type === "heading_open")
          node.attrs = { level: Number(token.tag.slice(1)) };
        if (token.type === "ordered_list_open")
          node.attrs = { start: Number(token.attrGet("start") ?? 1) };
        append(node);
        stack.push(node);
      } else if (token.nesting === -1) {
        const node = stack.pop();
        if (["tableCell", "tableHeader"].includes(node.type))
          node.content = [{ type: "paragraph", content: node.content }];
        if (
          node.type === "paragraph" &&
          node.content.some((child) => child.type === "assetImage")
        ) {
          if (node.content.some((child) => child.type !== "assetImage"))
            fail(token, "put an image on its own paragraph");
          const siblings = stack.at(-1).content;
          siblings.splice(siblings.indexOf(node), 1, ...node.content);
        }
      } else if (token.type === "inline")
        stack.at(-1).content.push(...inline(token.children, token));
      else if (["fence", "code_block"].includes(token.type))
        append({
          type: "codeBlock",
          attrs: { language: token.info.trim() || null },
          content: token.content ? [{ type: "text", text: token.content }] : [],
        });
      else if (token.type === "hr") append({ type: "horizontalRule" });
      else if (token.type === "inside_callout") {
        const content = blocks(parser.parse(token.meta.content, {})).content;
        if (!content.length) fail(token, "empty callout");
        if (["variant-example", "variant-own"].includes(token.meta.kind)) {
          const mode = token.meta.kind.slice("variant-".length);
          const option = { type: "variantOption", attrs: { mode }, content };
          const previous = stack.at(-1).content.at(-1);
          if (
            previous?.type === "variant" &&
            previous.content.length === 1 &&
            previous.content[0].attrs.mode !== mode
          )
            previous.content.push(option);
          else append({ type: "variant", content: [option] });
        } else {
          const kind = {
            info: "note",
            note: "note",
            tip: "tip",
            warning: "warning",
            important: "warning",
            example: "example",
            good: "good",
            bad: "bad",
            definition: "definition",
            todo: "task",
          }[token.meta.kind];
          if (!kind) fail(token, `unsupported callout: ${token.meta.kind}`);
          // The reader already sees the kind's own name, so a title repeating it is dropped.
          const title =
            token.meta.title === calloutToneLabels[kind]
              ? null
              : token.meta.title;
          append({ type: "callout", attrs: { kind, title }, content });
        }
      } else fail(token, `unsupported Markdown block: ${token.type}`);
    }
    return root;
  };
  const doc = blocks(parser.parse(markdown, {}));
  // IDs are stable for unchanged positions, and are independent of filenames and target environments.
  function assign(node, path) {
    if (addressableMaterialBlockTypes.includes(node.type))
      node.attrs = {
        ...node.attrs,
        nodeId: sourceUuid(`${sourceId}:${path.join(".")}`),
      };
    if (node.marks)
      node.marks.sort(
        (left, right) =>
          materialDocumentSchemaV1.marks[left.type].rank -
          materialDocumentSchemaV1.marks[right.type].rank,
      );
    if (node.content) {
      const merged = [];
      for (const child of node.content) {
        const previous = merged.at(-1);
        if (
          child.type === "text" &&
          previous?.type === "text" &&
          JSON.stringify(child.marks ?? []) ===
            JSON.stringify(previous.marks ?? [])
        )
          previous.text += child.text;
        else merged.push(child);
      }
      node.content = merged;
      node.content.forEach((child, index) => assign(child, [...path, index]));
    }
  }
  assign(doc, []);
  return { schemaVersion: 1, doc };
}
