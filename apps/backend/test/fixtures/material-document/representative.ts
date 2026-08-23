import type { MaterialDocumentV1 } from "../../../src/modules/materials/index.js";

export function representativeDocument(text = "Issue хранит intent."): MaterialDocumentV1 {
  return {
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
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

export function fullRepresentativeDocument(): MaterialDocumentV1 {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, nodeId: "01000000-0000-4000-8000-000000000001" },
          content: [{ type: "text", text: "Developer Pipeline" }],
        },
        {
          type: "paragraph",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000002" },
          content: [
            { type: "text", text: "Issue", marks: [{ type: "bold" }] },
            { type: "text", text: " хранит intent и " },
            {
              type: "text",
              text: "evidence",
              marks: [{ type: "link", attrs: { href: "https://example.com/evidence" } }],
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "bulletList",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000003" },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { nodeId: "01000000-0000-4000-8000-000000000011" },
                  content: [{ type: "text", text: "Issue" }],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000004" },
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000012" },
              content: [{ type: "text", text: "Owner gate." }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000005" },
          content: [{ type: "text", text: "pnpm check" }],
        },
        {
          type: "table",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000006" },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000013" },
                      content: [{ type: "text", text: "Stage" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000014" },
                      content: [{ type: "text", text: "Evidence" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000015" },
                      content: [{ type: "text", text: "Review" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000016" },
                      content: [{ type: "text", text: "Checks" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "callout",
          attrs: {
            kind: "warning",
            nodeId: "01000000-0000-4000-8000-000000000007",
          },
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000017" },
              content: [{ type: "text", text: "Publish requires owner GO." }],
            },
          ],
        },
        {
          type: "assetImage",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000008",
            assetId: "02000000-0000-4000-8000-000000000001",
            alt: "Delivery stages",
            caption: "One retained path",
          },
        },
        {
          type: "assetFile",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000009",
            assetId: "02000000-0000-4000-8000-000000000002",
            label: "Pipeline checklist",
          },
        },
        {
          type: "video",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000010",
            videoId: "03000000-0000-4000-8000-000000000001",
            caption: "Platform build episode",
          },
        },
      ],
    },
  };
}
