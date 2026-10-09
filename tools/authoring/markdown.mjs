// @ts-check
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import {
  addressableMaterialBlockTypes,
  calloutToneLabels,
} from "@inside/material-blocks";
import MarkdownIt from "markdown-it";
import { createHash } from "node:crypto";

/**
 * @typedef {import("@inside/material-blocks").CalloutTone} CalloutTone
 * @typedef {ReturnType<typeof parser.parse>[number]} Token
 * @typedef {{ type: string; attrs?: { href: string } }} DocMark
 * @typedef {object} DocNode
 * @property {string} type
 * @property {string} [text]
 * @property {DocMark[]} [marks]
 * @property {Record<string, unknown>} [attrs]
 * @property {DocNode[]} [content]
 * @typedef {DocNode & { content: DocNode[] }} ContainerNode
 */

const parser = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
});
const calloutHeader = /^>\s*\[!([a-z-]+)\]([+-])?(?:\s+(.*))?$/u;
parser.block.ruler.before(
  "blockquote",
  "inside_callout",
  (state, start, end, silent) => {
    const first = state.src.slice(
      lineAt(state.bMarks, start) + lineAt(state.tShift, start),
      lineAt(state.eMarks, start),
    );
    const match = calloutHeader.exec(first);
    if (match === null) return false;
    if (silent) return true;
    const lines = [];
    /** @type {string | null} */
    let fence = null;
    let next = start + 1;
    for (; next < end; next += 1) {
      const line = state.src.slice(
        lineAt(state.bMarks, next) + lineAt(state.tShift, next),
        lineAt(state.eMarks, next),
      );
      if (!line.startsWith(">") || (fence === null && calloutHeader.test(line)))
        break;
      const content = line.replace(/^> ?/u, "");
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(content);
      // Both groups always take part in a match.
      const [, markerFence = "", markerInfo = ""] = marker ?? [];
      if (fence === null) {
        if (marker && (markerFence[0] !== "`" || !markerInfo.includes("`")))
          fence = markerFence;
      } else if (
        marker &&
        markerFence[0] === fence[0] &&
        markerFence.length >= fence.length &&
        /^\s*$/u.test(markerInfo)
      ) {
        fence = null;
      }
      lines.push(content);
    }
    const token = state.push("inside_callout", "", 0);
    token.map = [start, next];
    token.meta = {
      kind: match[1],
      collapse:
        match[2] === "-" ? "collapsed" : match[2] === "+" ? "expanded" : null,
      title: match[3] ?? null,
      content: lines.join("\n"),
    };
    state.line = next;
    return true;
  },
);

/**
 * A line offset markdown-it keeps for every source line.
 *
 * @param {number[]} offsets
 * @param {number} line
 */
function lineAt(offsets, line) {
  const offset = offsets[line];
  if (offset === undefined) throw new Error(`Markdown line ${line} is unknown`);
  return offset;
}

/**
 * The callout this file's `inside_callout` rule stored on its token.
 *
 * @param {Token} token
 */
function calloutMeta(token) {
  const kind = token.meta?.["kind"];
  const title = token.meta?.["title"];
  const content = token.meta?.["content"];
  const collapse = token.meta?.["collapse"];
  if (
    typeof kind !== "string" ||
    (typeof title !== "string" && title !== null) ||
    typeof content !== "string" ||
    (collapse !== null && collapse !== "collapsed" && collapse !== "expanded")
  )
    throw new Error("Callout token lost its description");
  return { kind, title, content, collapse };
}

/**
 * The value a lookup table holds for one of its own keys.
 *
 * @template V
 * @param {Readonly<Record<string, V>>} table
 * @param {string} key
 * @returns {V | undefined}
 */
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** @type {Readonly<Record<string, string>>} */
const inlineMarkTypes = {
  strong_open: "bold",
  em_open: "italic",
  s_open: "strike",
};
/** @type {Readonly<Record<string, string>>} */
const blockTypes = {
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
/** @type {Readonly<Record<string, CalloutTone>>} */
const calloutKinds = {
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
};
// ProseMirror orders the marks of a node by their position in the schema.
const markRanks = new Map(
  Object.keys(materialDocumentSchemaV1.marks).map((name, rank) => [name, rank]),
);

/** @param {string} type */
function markRank(type) {
  const rank = markRanks.get(type);
  if (rank === undefined) throw new Error(`Unknown mark: ${type}`);
  return rank;
}

/** @param {string} value */
export function sourceUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * @param {string} markdown
 * @param {{
 *   sourcePath: string;
 *   sourceId: string;
 *   link: (href: string) => string;
 *   image: (src: string) => string;
 * }} source
 */
export function convertMarkdown(
  markdown,
  { sourcePath, sourceId, link, image },
) {
  /**
   * @param {Token} token
   * @param {string} message
   * @returns {never}
   */
  function fail(token, message) {
    throw new Error(`${sourcePath}:${(token.map?.[0] ?? 0) + 1}: ${message}`);
  }
  /**
   * @param {Token} token
   * @param {string} name
   */
  const attribute = (token, name) => {
    const value = token.attrGet(name);
    if (typeof value !== "string") fail(token, `missing ${name}`);
    return value;
  };
  /**
   * @param {Token[] | null} tokens
   * @param {Token} parent
   */
  const inline = (tokens, parent) => {
    /** @type {DocNode[]} */
    const nodes = [];
    /** @type {DocMark[]} */
    const marks = [];
    for (const token of tokens ?? []) {
      const markType = own(inlineMarkTypes, token.type);
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
      else if (markType !== undefined) marks.push({ type: markType });
      else if (token.type === "link_open")
        marks.push({
          type: "link",
          attrs: { href: link(attribute(token, "href")) },
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
            assetId: image(attribute(token, "src")),
            alt: token.content,
            caption: token.attrGet("title"),
          },
        });
      } else fail(parent, `unsupported inline Markdown: ${token.type}`);
    }
    return nodes;
  };
  /**
   * @param {Token[]} tokens
   * @returns {ContainerNode}
   */
  const blocks = (tokens) => {
    /** @type {ContainerNode} */
    const root = { type: "doc", content: [] };
    const stack = [root];
    // Closing tokens never outnumber opening ones, so the document root stays on the stack.
    const top = () => {
      const node = stack.at(-1);
      if (node === undefined)
        throw new Error(`${sourcePath}: unbalanced Markdown`);
      return node;
    };
    /** @param {DocNode} node */
    const append = (node) => top().content.push(node);
    for (const token of tokens) {
      const blockType = own(blockTypes, token.type);
      if (
        ["thead_open", "thead_close", "tbody_open", "tbody_close"].includes(
          token.type,
        )
      )
        continue;
      if (blockType !== undefined) {
        /** @type {ContainerNode} */
        const node = { type: blockType, content: [] };
        if (token.type === "heading_open")
          node.attrs = { level: Number(token.tag.slice(1)) };
        if (token.type === "ordered_list_open")
          node.attrs = { start: Number(token.attrGet("start") ?? 1) };
        append(node);
        stack.push(node);
      } else if (token.nesting === -1) {
        const node = stack.pop();
        if (node === undefined) fail(token, "unbalanced Markdown block");
        if (["tableCell", "tableHeader"].includes(node.type))
          node.content = [{ type: "paragraph", content: node.content }];
        if (
          node.type === "paragraph" &&
          node.content.some((child) => child.type === "assetImage")
        ) {
          if (node.content.some((child) => child.type !== "assetImage"))
            fail(token, "put an image on its own paragraph");
          const siblings = top().content;
          siblings.splice(siblings.indexOf(node), 1, ...node.content);
        }
      } else if (token.type === "inline")
        top().content.push(...inline(token.children, token));
      else if (["fence", "code_block"].includes(token.type))
        append({
          type: "codeBlock",
          attrs: { language: token.info.trim() || null },
          content: token.content ? [{ type: "text", text: token.content }] : [],
        });
      else if (token.type === "hr") append({ type: "horizontalRule" });
      else if (token.type === "inside_callout") {
        const meta = calloutMeta(token);
        const content = blocks(parser.parse(meta.content, {})).content;
        if (!content.length) fail(token, "empty callout");
        if (["variant-example", "variant-own"].includes(meta.kind)) {
          const mode = meta.kind.slice("variant-".length);
          const option = { type: "variantOption", attrs: { mode }, content };
          const previous = top().content.at(-1);
          if (
            previous?.type === "variant" &&
            previous.content?.length === 1 &&
            previous.content[0]?.attrs?.["mode"] !== mode
          )
            previous.content.push(option);
          else append({ type: "variant", content: [option] });
        } else {
          const kind = own(calloutKinds, meta.kind);
          if (!kind) fail(token, `unsupported callout: ${meta.kind}`);
          // The reader already sees the kind's own name, so a title repeating it is dropped.
          const title =
            meta.collapse === null && meta.title === calloutToneLabels[kind]
              ? null
              : meta.title;
          append({
            type: "callout",
            attrs: { kind, title, collapse: meta.collapse },
            content,
          });
        }
      } else fail(token, `unsupported Markdown block: ${token.type}`);
    }
    return root;
  };
  const doc = blocks(parser.parse(markdown, {}));
  /**
   * IDs are stable for unchanged positions, and are independent of filenames and target
   * environments.
   *
   * @param {DocNode} node
   * @param {number[]} path
   */
  function assign(node, path) {
    if (addressableMaterialBlockTypes.includes(node.type))
      node.attrs = {
        ...node.attrs,
        nodeId: sourceUuid(`${sourceId}:${path.join(".")}`),
      };
    if (node.marks)
      node.marks.sort(
        (left, right) => markRank(left.type) - markRank(right.type),
      );
    if (node.content) {
      /** @type {DocNode[]} */
      const merged = [];
      for (const child of node.content) {
        const previous = merged.at(-1);
        if (
          child.type === "text" &&
          previous?.type === "text" &&
          JSON.stringify(child.marks ?? []) ===
            JSON.stringify(previous.marks ?? [])
        )
          previous.text = `${previous.text ?? ""}${child.text ?? ""}`;
        else merged.push(child);
      }
      node.content = merged;
      node.content.forEach((child, index) => assign(child, [...path, index]));
    }
  }
  assign(doc, []);
  return { schemaVersion: 1, doc };
}
