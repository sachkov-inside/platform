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

test("soft line breaks merge adjacent equal-mark text without dropping author words", () => {
  const doc = convert("One line\nsecond line **bold**\nthird line.");
  const content = doc.content[0].content;
  assert.equal(content[0].text, "One line\nsecond line ");
  assert.equal(content[1].text, "bold");
  assert.equal(content[2].text, "\nthird line.");
  assert.deepEqual(JSON.parse(JSON.stringify(materialDocumentSchemaV1.nodeFromJSON(doc).toJSON())), doc);
});

test("callout fences retain literal headers and adjacent callouts stay separate", () => {
  for (const marker of ["```", "~~~", "````", "~~~~"]) {
    const other = marker[0] === "`" ? "~~~" : "```";
    const literal = [other, marker.slice(0, -1), `${marker} not a closing fence`, "[!info] Literal header", "Literal text"].join("\n");
    const body = `${marker}markdown\n${literal}\n${marker}${marker[0]}\n`;
    const quoted = body.trimEnd().split("\n").map((line) => `> ${line}`).join("\n");
    const doc = convert(`> [!example]- Example\n${quoted}\n> [!tip] Adjacent\n> Following text\n`);
    assert.deepEqual(doc.content.map((node) => node.type), ["callout", "callout"]);
    assert.equal(doc.content[0].attrs.kind, "example");
    assert.equal(doc.content[0].content.length, 1);
    assert.equal(doc.content[0].content[0].type, "codeBlock");
    assert.equal(doc.content[0].content[0].content[0].text, `${literal}\n`);
    assert.equal(doc.content[1].attrs.kind, "tip");
    assert.equal(doc.content[1].content[0].content[0].text, "Following text");
  }
});
