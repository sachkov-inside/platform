import { expect, test } from "vitest";
import { referencedTermIds } from "@inside/material-blocks";
import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";

const termId = "44300000-0000-4000-8000-000000000001";
function snapshot(marks: unknown[]) {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: "44300000-0000-4000-8000-000000000011" },
          content: [{ type: "text", text: "выкатить версию", marks }],
        },
      ],
    },
  };
}

test("MaterialBody accepts and reopens typed terms without a definition snapshot or changes to author text", () => {
  const accepted = materialBodyOperations.accept(
    snapshot([{ type: "term", attrs: { termId } }]),
  );
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error("Expected accepted body");
  expect(materialBodyOperations.accept(accepted.value)).toEqual(accepted);
  const rendered = materialBodyOperations.render(accepted.value);
  expect(rendered.ok).toBe(true);
  if (!rendered.ok) throw new Error("Expected rendered body");
  expect(referencedTermIds(rendered.value.blocks)).toEqual([termId]);
  const extracted = materialBodyOperations.extract(accepted.value);
  expect(extracted.ok && extracted.value.plainText).toBe("выкатить версию");
});

test("MaterialBody rejects a path as term identity and overlapping ordinary links", () => {
  const malformed = materialBodyOperations.accept(
    snapshot([{ type: "term", attrs: { termId: "terms/deploy.md" } }]),
  );
  expect(malformed).toMatchObject({
    ok: false,
    error: { issues: [{ code: "invalid_term_reference" }] },
  });
  const overlap = materialBodyOperations.accept(
    snapshot([
      { type: "link", attrs: { href: "/materials/deploy" } },
      { type: "term", attrs: { termId } },
    ]),
  );
  expect(overlap).toMatchObject({
    ok: false,
    error: { issues: [{ code: "overlapping_term_reference" }] },
  });
});
