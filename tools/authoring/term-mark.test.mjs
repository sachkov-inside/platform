// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import { renderMaterialBlocks } from "@inside/material-blocks";
import { convertMarkdown } from "./markdown.mjs";
import { prepareTermReferences } from "./term-references.mjs";

const termId = "44300000-0000-4000-8000-000000000001";
const term = prepareTermReferences([
  {
    definition: {
      id: termId,
      title: "Деплой",
      aliases: ["deploy"],
      definition: "Авторское определение",
    },
    publicationState: "published",
    available: true,
  },
]);
const options = {
  sourcePath: "lesson.md",
  sourceId: "lesson",
  link: (/** @type {string} */ href) => href,
  image: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  term,
};

test("Markdown imports a reusable term ID and independent phrase, preserving ordinary links and roundtrip", () => {
  const body = convertMarkdown(
    "**[[deploy|выкатить версию]]** и [подробный материал](/materials/deploy).",
    options,
  );
  const doc = materialDocumentSchemaV1.nodeFromJSON(body.doc);
  doc.check();
  const saved = z.json().parse(JSON.parse(JSON.stringify(doc.toJSON())));
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(materialDocumentSchemaV1.nodeFromJSON(saved).toJSON()),
    ),
    saved,
  );
  const blocks = renderMaterialBlocks(
    z.array(z.json()).parse(body.doc.content),
  );
  assert.equal(blocks[0]?.kind, "paragraph");
  if (blocks[0]?.kind !== "paragraph") throw new Error("Expected paragraph");
  assert.deepEqual(blocks[0].content[0], {
    kind: "text",
    text: "выкатить версию",
    marks: [{ kind: "bold" }, { kind: "term", termId }],
  });
  assert.deepEqual(blocks[0].content[2]?.marks, [
    { kind: "link", href: "/materials/deploy" },
  ]);
  assert.equal(JSON.stringify(body).includes("Авторское определение"), false);
});

test("only real inline wiki references resolve; code and escaped syntax remain author text", () => {
  const body = convertMarkdown(
    "`[[Unknown]]` and \\[[Unknown]].\n\n```text\n[[Unknown]]\n```",
    options,
  );
  assert.equal(JSON.stringify(body).includes('"type":"term"'), false);
  assert.throws(() => convertMarkdown("[[Unknown]]", options), /Missing term/u);
  assert.throws(
    () => convertMarkdown("[ [[deploy]] ](https://example.com)", options),
    /nested in a link/u,
  );
  assert.throws(
    () => convertMarkdown("[[deploy]]", { ...options, term: undefined }),
    /requires authored/u,
  );
});
