import { test } from "node:test";
import assert from "node:assert/strict";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import { convertMarkdown } from "./markdown.mjs";

const options = { sourcePath: "chapter/lesson.md", sourceId: "lesson", link: (href) => href, image: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
function convert(markdown) {
  const snapshot = convertMarkdown(markdown, options);
  materialDocumentSchemaV1.nodeFromJSON(snapshot.doc).check();
  return snapshot.doc;
}

test("real authoring constructs preserve variant placement, bold code, tables and example fences", () => {
  const doc = convert("Introduction **`command`**.\n\n> [!variant-example] Учебный проект\n> Example\n\nShared step.\n\n> [!variant-own] Свой проект\n> Own project\n\n| A | B |\n|---|---|\n| One | Two |\n\n> [!example]- Example\n> ```text\n> literal\n> ```\n");
  assert.deepEqual(doc.content.map((node) => node.type), ["paragraph", "variant", "paragraph", "variant", "table", "callout"]);
  const code = doc.content[0].content.find((node) => node.text === "command");
  assert.deepEqual(new Set(code.marks.map((mark) => mark.type)), new Set(["bold", "code"]));
  assert.equal(doc.content[5].content[0].type, "codeBlock");
});

test("unsupported constructs report original path and prevent replacement", () => {
  assert.throws(() => convert("Text\n\n<script>alert(1)</script>"), /chapter\/lesson.md:3: unsupported Markdown block/);
  assert.throws(() => convert("> [!unknown]\n> Text"), /unsupported callout/);
});

test("renaming the original does not change node identities", () => {
  const first = convertMarkdown("# Title\n\nText", options);
  const renamed = convertMarkdown("# Title\n\nText", { ...options, sourcePath: "moved.md" });
  assert.deepEqual(first, renamed);
});
