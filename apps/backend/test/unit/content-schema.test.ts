import { describe, expect, test } from "vitest";

import { createContentSchema } from "../../src/modules/content-schema/index.js";
import {
  fullRepresentativeDocument,
  representativeDocument,
} from "../fixtures/content-schema/representative.js";

describe("ContentSchema", () => {
  test("accepts a representative v1 document without semantic drift", () => {
    const contentSchema = createContentSchema();
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

    expect(contentSchema.acceptDocument(input)).toEqual({
      ok: true,
      value: input,
    });
  });

  test("round-trips every retained v1 body shape through the Tiptap schema", () => {
    const contentSchema = createContentSchema();
    const document = fullRepresentativeDocument();

    expect(contentSchema.acceptDocument(document)).toEqual({ ok: true, value: document });
  });

  test("canonicalizes accepted content and rejects non-JSON or duplicate nested node IDs", () => {
    const contentSchema = createContentSchema();
    const canonicalized = contentSchema.acceptDocument({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "assetImage",
            attrs: {
              nodeId: "89000000-0000-4000-8000-000000000001",
              assetId: "89000000-0000-4000-8000-000000000002",
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
                assetId: "89000000-0000-4000-8000-000000000002",
                nodeId: "89000000-0000-4000-8000-000000000001",
              },
              type: "assetImage",
            },
          ],
          type: "doc",
        },
      },
    });
    expect(contentSchema.acceptDocument(undefined)).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "document_is_not_json", path: "" }],
      },
    });

    const nestedDuplicate = fullRepresentativeDocument();
    const blocks = nestedDuplicate.doc.content;
    if (!Array.isArray(blocks)) {
      throw new Error("Expected document blocks");
    }
    const list = blocks[2];
    if (
      list === null ||
      Array.isArray(list) ||
      typeof list !== "object" ||
      !Array.isArray(list.content)
    ) {
      throw new Error("Expected list content");
    }
    const item = list.content[0];
    if (
      item === null ||
      Array.isArray(item) ||
      typeof item !== "object" ||
      !Array.isArray(item.content)
    ) {
      throw new Error("Expected list item content");
    }
    const paragraph = item.content[0];
    if (paragraph === null || Array.isArray(paragraph) || typeof paragraph !== "object") {
      throw new Error("Expected nested paragraph");
    }
    paragraph.attrs = { nodeId: "01000000-0000-4000-8000-000000000001" };

    expect(contentSchema.acceptDocument(nestedDuplicate)).toMatchObject({
      ok: false,
      error: { issues: [{ code: "duplicate_node_id" }] },
    });
  });

  test("replaces text across marked text nodes without dropping unaffected marks", () => {
    const contentSchema = createContentSchema();
    const result = contentSchema.applyChanges(fullRepresentativeDocument(), [
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
        { type: "text", text: " сохраняет intent и " },
        {
          type: "text",
          text: "evidence",
          marks: [{ type: "link", attrs: { href: "https://example.com/evidence" } }],
        },
        { type: "text", text: "." },
      ],
    });

    const insertedIntoEmptyBlock = contentSchema.applyChanges(
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
    const contentSchema = createContentSchema();
    const result = contentSchema.applyChanges(representativeDocument(), [
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
      attrs: { nodeId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      content: [{ type: "text", text: "Новый блок" }],
    });
  });

  test("fails closed for duplicate IDs, unsafe links, unknown nodes and document limits", () => {
    const contentSchema = createContentSchema();
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
      contentSchema.acceptDocument({
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
    expect(contentSchema.acceptDocument(unsafeLink)).toMatchObject({
      ok: false,
      error: { issues: [{ code: "unsafe_link" }] },
    });
    expect(contentSchema.acceptDocument(unknownNode)).toMatchObject({
      ok: false,
      error: { issues: [{ code: "invalid_prosemirror_document" }] },
    });
    expect(contentSchema.acceptDocument(oversized)).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "document_too_large", path: "" }],
      },
    });
    const migrated = contentSchema.acceptDocument(representativeDocument());
    if (!migrated.ok) {
      throw new Error(migrated.error.issues[0]?.code);
    }
    expect(contentSchema.acceptDocument(migrated.value)).toEqual(migrated);
  });
});
