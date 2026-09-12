import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isUnknownArray, isUnknownRecord } from "@inside/material-blocks";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";

import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";
import {
  fullRepresentativeDocument,
  representativeDocument,
} from "../fixtures/material-body/representative.js";
import { stringMatching } from "../support/matchers.js";

function invalidFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(
        `../fixtures/material-body/invalid/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown;
}

function testNodeId(index: number): string {
  return `92000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// The editor serializes exactly what this schema builds, so the test assembles a document the
// same way instead of hand-writing JSON. Node and attribute types come from the schema itself:
// the backend depends on the block registry, not on Tiptap.
type DocumentNode = ReturnType<typeof materialDocumentSchemaV1.text>;
type DocumentAttributes = Parameters<typeof materialDocumentSchemaV1.node>[1];

function documentNode(
  name: string,
  attrs: DocumentAttributes,
  content?: readonly DocumentNode[],
): DocumentNode {
  return materialDocumentSchemaV1.node(name, attrs, content);
}

describe("MaterialBodyOperations", () => {
  test("accepts decorative image alt as empty text while still rejecting a missing attribute", () => {
    const image = (alt: unknown) => ({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "assetImage",
            attrs: { nodeId: testNodeId(1), assetId: testNodeId(2), alt },
          },
        ],
      },
    });
    expect(materialBodyOperations.accept(image("")).ok).toBe(true);
    expect(materialBodyOperations.accept(image(undefined)).ok).toBe(false);
  });

  test("persists image display width separately from pixel dimensions and rejects invalid sizes", () => {
    const image = (displayWidthPercent: unknown) => ({
      schemaVersion: 1,
      doc: { type: "doc", content: [{ type: "assetImage", attrs: {
        nodeId: testNodeId(1), assetId: testNodeId(2), alt: "", displayWidthPercent,
      } }] },
    });
    for (const width of [25, 50, 100]) {
      const accepted = materialBodyOperations.accept(image(width));
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error("Image rejected");
      const rendered = materialBodyOperations.render(accepted.value);
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) throw new Error("Image render rejected");
      expect(rendered.value.blocks[0]).toMatchObject({ kind: "image", displayWidthPercent: width });
    }
    for (const width of [0, 24, 101, 50.5, "50", { width: 50 }]) expect(materialBodyOperations.accept(image(width)).ok).toBe(false);
  });

  test("accepts a representative v1 document without semantic drift", () => {
    const documentOperations = materialBodyOperations;
    const input = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: {
              level: 2,
              nodeId: "11111111-1111-4111-8111-111111111111",
            },
            content: [{ type: "text", text: "Developer Pipeline" }],
          },
          {
            type: "paragraph",
            attrs: { nodeId: "22222222-2222-4222-8222-222222222222" },
            content: [
              {
                type: "text",
                text: "Issue хранит intent, а Material — current content.",
              },
            ],
          },
          {
            type: "callout",
            attrs: {
              kind: "warning",
              nodeId: "33333333-3333-4333-8333-333333333333",
            },
            content: [
              {
                type: "paragraph",
                attrs: { nodeId: "88888888-8888-4888-8888-888888888880" },
                content: [{ type: "text", text: "Publish требует owner GO." }],
              },
            ],
          },
          {
            type: "assetImage",
            attrs: {
              assetId: "44444444-4444-4444-8444-444444444444",
              alt: "Схема delivery",
              caption: "Один проверяемый путь",
              nodeId: "55555555-5555-4555-8555-555555555555",
            },
          },
        ],
      },
    } as const;

    expect(documentOperations.accept(input)).toEqual({
      ok: true,
      value: input,
    });
  });

  test("round-trips every retained v1 body shape through the Tiptap schema", () => {
    const documentOperations = materialBodyOperations;
    const document = fullRepresentativeDocument();

    expect(documentOperations.accept(document)).toEqual({
      ok: true,
      value: document,
    });
  });

  test("renders and extracts the representative document without executable or private data", () => {
    const documentOperations = materialBodyOperations;
    const document = fullRepresentativeDocument();

    const rendered = documentOperations.render(document);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) {
      throw new Error(rendered.error.issues[0]?.code);
    }
    expect(rendered.value.schemaVersion).toBe(1);
    expect(rendered.value.blocks.slice(0, 2)).toEqual([
      {
        kind: "heading",
        level: 2,
        content: [{ kind: "text", text: "Developer Pipeline", marks: [] }],
      },
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Issue", marks: [{ kind: "bold" }] },
          { kind: "text", text: " хранит ", marks: [{ kind: "italic" }] },
          { kind: "text", text: "intent", marks: [{ kind: "code" }] },
          { kind: "text", text: " и ", marks: [{ kind: "strike" }] },
          {
            kind: "text",
            text: "evidence",
            marks: [{ kind: "link", href: "https://example.com/evidence" }],
          },
          { kind: "text", text: ".", marks: [] },
        ],
      },
    ]);

    expect(documentOperations.extract(document)).toEqual({
      ok: true,
      value: {
        // Обе ветки вариантного шага попадают в текст поиска: читатель ищет слова того варианта,
        // который сейчас не видит.
        hasModeVariants: true,
        plainText:
          "Developer Pipeline\n\nIssue хранит intent и evidence.\n\nDecision\n\nIssue\n\nOwner gate.\n\npnpm check\n\nStage\tEvidence\nReview\tChecks\n\nPublish requires owner GO.\n\nПример\n\nКороткий разбор одного шага.\n\nСпецификация Platform\nЧто обещает контракт\nhttps://example.com/spec\n\nПромпт для разбора\n\nРазбери материал и предложи три правки.\n\nИтоги урока\n\nОдин authority\n\nОдна проверка\n\nADR — Решение — Фиксирует необратимый выбор\nGate — Проверка\n\nУчебный проект: повторите шаг на образце.\n\nСвой проект: примените шаг к своему репозиторию.\n\nВид блока задаёт платформа, а не вёрстка урока.\n\nDelivery stages\nOne retained path\n\nPipeline checklist",
        headings: [{ level: 2, text: "Developer Pipeline" }],
        resources: [
          {
            kind: "image",
            assetId: "02000000-0000-4000-8000-000000000001",
            alt: "Delivery stages",
            caption: "One retained path",
          },
          {
            kind: "file",
            assetId: "02000000-0000-4000-8000-000000000002",
            label: "Pipeline checklist",
          },
        ],
      },
    });
  });

  test("accepts a document the editor assembled through the shared document schema", () => {
    const text = (value: string) => materialDocumentSchemaV1.text(value);
    const paragraph = (index: number, value: string) =>
      documentNode("paragraph", { nodeId: testNodeId(index) }, [text(value)]);
    const cell = (name: "tableCell" | "tableHeader", index: number, value: string) =>
      documentNode(name, null, [paragraph(index, value)]);

    const document = documentNode("doc", null, [
      documentNode("heading", { level: 2, nodeId: testNodeId(1) }, [text("Заголовок")]),
      paragraph(2, "Обычный абзац."),
      documentNode("bulletList", { nodeId: testNodeId(3) }, [
        documentNode("listItem", null, [paragraph(4, "Пункт")]),
      ]),
      documentNode("blockquote", { nodeId: testNodeId(5) }, [paragraph(6, "Цитата")]),
      documentNode("codeBlock", { nodeId: testNodeId(7) }, [text("const a = 1;")]),
      documentNode("horizontalRule", { nodeId: testNodeId(8) }),
      documentNode("table", { nodeId: testNodeId(9) }, [
        documentNode("tableRow", null, [
          cell("tableHeader", 10, "Ключ"),
          cell("tableCell", 11, "Значение"),
        ]),
      ]),
      documentNode("callout", { kind: "tip", nodeId: testNodeId(12) }, [paragraph(13, "Совет")]),
      documentNode("assetImage", {
        alt: "Схема",
        assetId: testNodeId(14),
        nodeId: testNodeId(15),
      }),
      documentNode("assetFile", {
        assetId: testNodeId(16),
        label: "Отчёт",
        nodeId: testNodeId(17),
      }),
    ]);

    const serialized: unknown = document.toJSON();
    const accepted = materialBodyOperations.accept({ schemaVersion: 1, doc: serialized });

    // A rejected document reports why; `document_would_be_normalized` is the drift this guards.
    expect(accepted.ok ? [] : accepted.error.issues).toEqual([]);
  });

  test("reports the field rule of every lesson block and keeps stored callouts valid", () => {
    for (const [fixture, code] of [
      ["invalid-callout-kind", "invalid_callout_kind"],
      ["invalid-callout-title", "invalid_callout_title"],
      ["missing-resource-title", "missing_resource_title"],
      ["invalid-resource-url", "invalid_resource_url"],
      ["invalid-resource-description", "invalid_resource_description"],
      ["invalid-agent-prompt-title", "invalid_agent_prompt_title"],
      ["missing-takeaways-title", "missing_takeaways_title"],
      ["invalid-labeled-rows", "invalid_labeled_rows"],
      // A key point holds inline text only, so a nested block never reaches a field rule.
      ["invalid-key-point-content", "invalid_prosemirror_document"],
    ] as const) {
      expect([fixture, materialBodyOperations.accept(invalidFixture(fixture))]).toMatchObject([
        fixture,
        { ok: false, error: { issues: [{ code }] } },
      ]);
    }

    // A callout stored before the lesson kinds existed carries no name and no new kind.
    const stored = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { kind: "note", nodeId: testNodeId(30) },
            content: [
              {
                type: "paragraph",
                attrs: { nodeId: testNodeId(31) },
                content: [{ type: "text", text: "Старая врезка" }],
              },
            ],
          },
        ],
      },
    } as const;
    const accepted = materialBodyOperations.accept(stored);
    expect(accepted).toEqual({ ok: true, value: stored });
    if (!accepted.ok) throw new Error("Stored callout must stay valid");
    const rendered = materialBodyOperations.render(accepted.value);
    if (!rendered.ok) throw new Error("Stored callout must render");
    // A callout the author never named carries no name at all, not an empty one.
    expect(rendered.value.blocks).toEqual([
      {
        content: [
          { content: [{ kind: "text", marks: [], text: "Старая врезка" }], kind: "paragraph" },
        ],
        kind: "callout",
        tone: "note",
      },
    ]);
  });

  test("rejects the removed legacy inline Video node", () => {
    expect(
      materialBodyOperations.accept({
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "video",
              attrs: {
                nodeId: "77777777-7777-4777-8777-777777777777",
                videoId: "66666666-6666-4666-8666-666666666666",
              },
            },
          ],
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_content" } });
  });

  test("canonicalizes accepted content and rejects non-JSON or duplicate nested node IDs", () => {
    const documentOperations = materialBodyOperations;
    const canonicalized = documentOperations.accept({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "assetImage",
            attrs: {
              nodeId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
              assetId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
              alt: "Diagram",
              caption: null,
            },
          },
        ],
      },
    });

    expect(canonicalized).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        doc: {
          content: [
            {
              attrs: {
                alt: "Diagram",
                assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              },
              type: "assetImage",
            },
          ],
          type: "doc",
        },
      },
    });
    expect(documentOperations.accept(undefined)).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "document_is_not_json", path: "" }],
      },
    });

    const nestedDuplicate = fullRepresentativeDocument();
    const blocks = nestedDuplicate.doc.content;
    if (!isUnknownArray(blocks)) {
      throw new Error("Expected document blocks");
    }
    const list = blocks[2];
    if (!isUnknownRecord(list) || !isUnknownArray(list.content)) {
      throw new Error("Expected list content");
    }
    const item = list.content[0];
    if (!isUnknownRecord(item) || !isUnknownArray(item.content)) {
      throw new Error("Expected list item content");
    }
    const paragraph = item.content[0];
    if (!isUnknownRecord(paragraph)) {
      throw new Error("Expected nested paragraph");
    }
    paragraph.attrs = { nodeId: "01000000-0000-4000-8000-000000000001" };

    expect(documentOperations.accept(nestedDuplicate)).toMatchObject({
      ok: false,
      error: { issues: [{ code: "duplicate_node_id" }] },
    });

    const caseInsensitiveDuplicate = representativeDocument();
    const caseInsensitiveBlocks = caseInsensitiveDuplicate.doc.content;
    if (!Array.isArray(caseInsensitiveBlocks)) {
      throw new Error("Expected document blocks");
    }
    expect(
      documentOperations.accept({
        ...caseInsensitiveDuplicate,
        doc: {
          ...caseInsensitiveDuplicate.doc,
          content: [
            {
              ...caseInsensitiveBlocks[0],
              attrs: {
                level: 2,
                nodeId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
              },
            },
            {
              ...caseInsensitiveBlocks[1],
              attrs: { nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ code: "duplicate_node_id" }] },
    });
  });

  test("replaces text across marked text nodes without dropping unaffected marks", () => {
    const documentOperations = materialBodyOperations;
    const result = documentOperations.applyChanges(
      fullRepresentativeDocument(),
      [
        {
          kind: "replace_text",
          nodeId: "01000000-0000-4000-8000-000000000002",
          from: 6,
          to: 12,
          text: "сохраняет",
        },
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.issues[0]?.code);
    }
    const blocks = result.value.doc.content;
    if (!Array.isArray(blocks)) {
      throw new Error("Expected document blocks");
    }
    expect(blocks[1]).toMatchObject({
      content: [
        { type: "text", text: "Issue", marks: [{ type: "bold" }] },
        { type: "text", text: " сохраняет ", marks: [{ type: "italic" }] },
        { type: "text", text: "intent", marks: [{ type: "code" }] },
        { type: "text", text: " и ", marks: [{ type: "strike" }] },
        {
          type: "text",
          text: "evidence",
          marks: [
            { type: "link", attrs: { href: "https://example.com/evidence" } },
          ],
        },
        { type: "text", text: "." },
      ],
    });

    const insertedIntoEmptyBlock = documentOperations.applyChanges(
      {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000018" },
            },
          ],
        },
      },
      [
        {
          kind: "replace_text",
          nodeId: "01000000-0000-4000-8000-000000000018",
          from: 0,
          to: 0,
          text: "First text",
        },
      ],
    );
    expect(insertedIntoEmptyBlock).toMatchObject({
      ok: true,
      value: {
        doc: {
          content: [
            {
              content: [{ type: "text", text: "First text" }],
            },
          ],
        },
      },
    });
  });

  test("applies semantic block and text changes while preserving stable node IDs", () => {
    const documentOperations = materialBodyOperations;
    const result = documentOperations.applyChanges(representativeDocument(), [
      {
        kind: "replace_text",
        nodeId: "22222222-2222-4222-8222-222222222222",
        from: 6,
        to: 12,
        text: "сохраняет",
      },
      {
        kind: "insert_blocks",
        afterNodeId: "22222222-2222-4222-8222-222222222222",
        blocks: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Новый блок" }],
          },
        ],
      },
      {
        kind: "replace_block",
        nodeId: "11111111-1111-4111-8111-111111111111",
        block: {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Retained slice" }],
        },
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.issues[0]?.code);
    }
    const blocks = result.value.doc.content;
    if (!Array.isArray(blocks)) {
      throw new Error("Expected document blocks");
    }
    expect(blocks).toHaveLength(3);
    expect(blocks?.[0]).toMatchObject({
      type: "heading",
      attrs: {
        level: 3,
        nodeId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(blocks?.[1]).toMatchObject({
      attrs: { nodeId: "22222222-2222-4222-8222-222222222222" },
      content: [{ type: "text", text: "Issue сохраняет intent." }],
    });
    expect(blocks?.[2]).toMatchObject({
      type: "paragraph",
      attrs: { nodeId: stringMatching(/^[0-9a-f-]{36}$/) },
      content: [{ type: "text", text: "Новый блок" }],
    });
  });

  test("addresses insert, replace, delete and text changes in nested blocks", () => {
    const documentOperations = materialBodyOperations;
    const result = documentOperations.applyChanges(
      {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "bulletList",
              attrs: { nodeId: testNodeId(1) },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: testNodeId(2) },
                      content: [{ type: "text", text: "First" }],
                    },
                    {
                      type: "paragraph",
                      attrs: { nodeId: testNodeId(3) },
                      content: [{ type: "text", text: "Second" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      [
        {
          kind: "replace_text",
          nodeId: testNodeId(2),
          from: 0,
          to: 5,
          text: "Primary",
        },
        {
          kind: "insert_blocks",
          afterNodeId: testNodeId(2),
          blocks: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Inserted" }],
            },
          ],
        },
        {
          kind: "replace_block",
          nodeId: testNodeId(3),
          block: {
            type: "paragraph",
            content: [{ type: "text", text: "Replaced" }],
          },
        },
        { kind: "delete_block", nodeId: testNodeId(3) },
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.issues[0]?.code);
    }
    const content = result.value.doc.content;
    if (!isUnknownArray(content)) {
      throw new Error("Expected document content");
    }
    const list = content[0];
    const item =
      isUnknownRecord(list) && isUnknownArray(list.content)
        ? list.content[0]
        : undefined;
    expect(item).toMatchObject({
      content: [
        {
          attrs: { nodeId: testNodeId(2) },
          content: [{ type: "text", text: "Primary" }],
        },
        {
          attrs: { nodeId: stringMatching(/^[0-9a-f-]{36}$/) },
          content: [{ type: "text", text: "Inserted" }],
        },
      ],
    });
  });

  test("assigns missing IDs only when accepting a new document", () => {
    const documentOperations = materialBodyOperations;
    const document = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "New" }] },
            ],
          },
        ],
      },
    };

    const existingDocument = documentOperations.accept(document);
    expect(existingDocument.ok).toBe(false);
    if (existingDocument.ok) {
      throw new Error("Expected missing node IDs to fail");
    }
    expect(
      existingDocument.error.issues.every(
        ({ code }) => code === "invalid_node_id",
      ),
    ).toBe(true);
    expect(
      documentOperations.accept(document, { assignMissingNodeIds: true }),
    ).toMatchObject({
      ok: true,
      value: {
        doc: {
          content: [
            {
              attrs: { nodeId: stringMatching(/^[0-9a-f-]{36}$/) },
              content: [
                {
                  attrs: { nodeId: stringMatching(/^[0-9a-f-]{36}$/) },
                },
              ],
            },
          ],
        },
      },
    });
    expect(document.doc.content[0]).not.toHaveProperty("attrs");
  });

  test("fails closed for duplicate IDs, unsafe links, unknown nodes and document limits", () => {
    const documentOperations = materialBodyOperations;
    const duplicateId = representativeDocument();
    const duplicateBlocks = duplicateId.doc.content;
    if (!Array.isArray(duplicateBlocks)) {
      throw new Error("Expected document blocks");
    }
    const unsafeLink = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: "88888888-8888-4888-8888-888888888888" },
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
    } as const;
    const unknownNode = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "rawHtml",
            attrs: {
              html: "<script>alert(1)</script>",
              nodeId: "99999999-9999-4999-8999-999999999999",
            },
          },
        ],
      },
    } as const;
    const oversized = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            content: [{ type: "text", text: "😀".repeat(300_000) }],
          },
        ],
      },
    };

    expect(
      documentOperations.accept({
        ...duplicateId,
        doc: {
          ...duplicateId.doc,
          content: [
            duplicateBlocks[0],
            {
              ...duplicateBlocks[1],
              attrs: {
                nodeId: "11111111-1111-4111-8111-111111111111",
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ code: "duplicate_node_id" }] },
    });
    expect(documentOperations.accept(unsafeLink)).toMatchObject({
      ok: false,
      error: { issues: [{ code: "unsafe_link" }] },
    });
    expect(documentOperations.accept(unknownNode)).toMatchObject({
      ok: false,
      error: { issues: [{ code: "invalid_prosemirror_document" }] },
    });
    expect(documentOperations.accept(oversized)).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "document_too_large", path: "" }],
      },
    });
    const migrated = documentOperations.accept(representativeDocument());
    if (!migrated.ok) {
      throw new Error(migrated.error.issues[0]?.code);
    }
    expect(documentOperations.accept(migrated.value)).toEqual(migrated);
  });

  test("enforces depth, node, text and bounded-issue limits", () => {
    const documentOperations = materialBodyOperations;
    let nested: unknown = {
      type: "paragraph",
      attrs: { nodeId: testNodeId(100) },
      content: [{ type: "text", text: "Deep" }],
    };
    for (let index = 0; index < 33; index += 1) {
      nested = {
        type: "blockquote",
        attrs: { nodeId: testNodeId(101 + index) },
        content: [nested],
      };
    }
    expect(
      documentOperations.accept({
        schemaVersion: 1,
        doc: { type: "doc", content: [nested] },
      }),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ code: "document_too_deep" }] },
    });

    const tooManyNodes = documentOperations.accept({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: Array.from({ length: 10_001 }, (_, index) => ({
          type: "horizontalRule",
          attrs: { nodeId: testNodeId(1_000 + index) },
        })),
      },
    });
    expect(tooManyNodes.ok).toBe(false);
    if (tooManyNodes.ok) {
      throw new Error("Expected node limit failure");
    }
    expect(
      tooManyNodes.error.issues.every(
        ({ code }) => code === "document_has_too_many_nodes",
      ),
    ).toBe(true);

    expect(
      documentOperations.accept({
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: testNodeId(20_000) },
              content: [{ type: "text", text: "x".repeat(500_001) }],
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ code: "document_has_too_much_text" }] },
    });

    const bounded = documentOperations.accept({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: Array.from({ length: 150 }, () => ({
          type: "horizontalRule",
        })),
      },
    });
    expect(bounded.ok).toBe(false);
    if (bounded.ok) {
      throw new Error("Expected bounded validation failure");
    }
    expect(bounded.error.issues).toHaveLength(100);
  });

  test.each([
    ["duplicate-node-id", "duplicate_node_id"],
    ["external-backslash-link", "unsafe_link"],
    ["invalid-nesting", "invalid_prosemirror_document"],
    ["invalid-resource-reference", "invalid_asset_id"],
    ["normalization-drift", "document_would_be_normalized"],
    ["unsafe-link", "unsafe_link"],
    ["unknown-mark", "invalid_prosemirror_document"],
    ["unknown-node", "invalid_prosemirror_document"],
  ])("rejects negative JSON fixture %s", (fixture, code) => {
    expect(
      materialBodyOperations.accept(invalidFixture(fixture)),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ code }] },
    });
  });
});
