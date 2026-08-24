import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";
import {
  isUnknownArray,
  isUnknownRecord,
} from "../../src/modules/materials/domain/material-body/json-guards.js";
import {
  fullRepresentativeDocument,
  representativeDocument,
} from "../fixtures/material-body/representative.js";
import { stringMatching } from "../support/matchers.js";

function invalidFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/material-body/invalid/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function testNodeId(index: number): string {
  return `92000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("MaterialBodyOperations", () => {
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
              { type: "text", text: "Issue хранит intent, а revision — content." },
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
          {
            type: "video",
            attrs: {
              videoId: "66666666-6666-4666-8666-666666666666",
              caption: "Выпуск 5",
              nodeId: "77777777-7777-4777-8777-777777777777",
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

    expect(documentOperations.accept(document)).toEqual({ ok: true, value: document });
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
        plainText:
          "Developer Pipeline\n\nIssue хранит intent и evidence.\n\nDecision\n\nIssue\n\nOwner gate.\n\npnpm check\n\nStage\tEvidence\nReview\tChecks\n\nPublish requires owner GO.\n\nDelivery stages\nOne retained path\n\nPipeline checklist\n\nPlatform build episode",
        headings: [{ level: 2, text: "Developer Pipeline" }],
        resources: [
          {
            kind: "image",
            alt: "Delivery stages",
            caption: "One retained path",
          },
          {
            kind: "file",
            label: "Pipeline checklist",
          },
          {
            kind: "video",
            caption: "Platform build episode",
          },
        ],
      },
    });
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
    if (
      !isUnknownRecord(list) ||
      !isUnknownArray(list.content)
    ) {
      throw new Error("Expected list content");
    }
    const item = list.content[0];
    if (
      !isUnknownRecord(item) ||
      !isUnknownArray(item.content)
    ) {
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
              attrs: { level: 2, nodeId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
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
    const result = documentOperations.applyChanges(fullRepresentativeDocument(), [
      {
        kind: "replace_text",
        nodeId: "01000000-0000-4000-8000-000000000002",
        from: 6,
        to: 12,
        text: "сохраняет",
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
    expect(blocks[1]).toMatchObject({
      content: [
        { type: "text", text: "Issue", marks: [{ type: "bold" }] },
        { type: "text", text: " сохраняет ", marks: [{ type: "italic" }] },
        { type: "text", text: "intent", marks: [{ type: "code" }] },
        { type: "text", text: " и ", marks: [{ type: "strike" }] },
        {
          type: "text",
          text: "evidence",
          marks: [{ type: "link", attrs: { href: "https://example.com/evidence" } }],
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
        { kind: "replace_text", nodeId: testNodeId(2), from: 0, to: 5, text: "Primary" },
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
      isUnknownRecord(list) &&
      isUnknownArray(list.content)
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
    expect(existingDocument.error.issues.every(({ code }) => code === "invalid_node_id")).toBe(
      true,
    );
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
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
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
      tooManyNodes.error.issues.every(({ code }) => code === "document_has_too_many_nodes"),
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
        content: Array.from({ length: 150 }, () => ({ type: "horizontalRule" })),
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
    expect(materialBodyOperations.accept(invalidFixture(fixture))).toMatchObject({
      ok: false,
      error: { issues: [{ code }] },
    });
  });
});
