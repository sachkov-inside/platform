import { describe, expect, test } from "vitest";

import { fingerprintCommand } from "../../src/modules/content-authoring/internal/canonical-command-fingerprint.js";
import {
  parseCreateDraftCommand,
  parseLoadDraftQuery,
  parseReviseDraftCommand,
} from "../../src/modules/content-authoring/internal/command-rules.js";

describe("ContentAuthoring command rules", () => {
  test("rejects malformed and unbounded command envelopes before application work", () => {
    expect(parseCreateDraftCommand(null)).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "invalid_command", path: "" }],
      },
    });
    expect(
      parseCreateDraftCommand({
        actor: "not-a-principal",
        idempotencyKey: "x".repeat(201),
        metadata: {
          title: "Title",
          summary: "Summary",
          slug: "title",
          topicId: "94000000-0000-4000-8000-000000000010",
          formatId: "94000000-0000-4000-8000-000000000011",
          tagIds: [],
          seriesMemberships: [],
        },
        body: {},
      }),
    ).toMatchObject({
      ok: false,
      error: {
        issues: [
          { code: "invalid_command", path: "/actor" },
          { code: "invalid_command", path: "/idempotencyKey" },
        ],
      },
    });
    expect(
      parseReviseDraftCommand({
        actor: "94000000-0000-4000-8000-000000000001",
        idempotencyKey: "bounded",
        materialId: "94000000-0000-4000-8000-000000000002",
        baseRevisionId: "94000000-0000-4000-8000-000000000003",
        changes: {
          body: [
            {
              kind: "replace_text",
              nodeId: "94000000-0000-4000-8000-000000000004",
              from: 0,
              to: 500_001,
              text: "bounded",
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ code: "invalid_command", path: "/changes/body/0/to" }] },
    });
  });

  test("canonicalizes command identifiers and fingerprints a versioned request envelope", () => {
    expect(
      parseLoadDraftQuery({
        actor: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        materialId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
      }),
    ).toEqual({
      ok: true,
      value: {
        actor: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        materialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    });
    expect(fingerprintCommand({ operation: "revise_draft", changes: {} })).toBe(
      "86e65b719b29a3f3c8f2ee0d79820728bd97e566f889110bc88d17159558b4ab",
    );
    expect(
      fingerprintCommand({ changes: {}, operation: "revise_draft" }),
    ).toBe(fingerprintCommand({ operation: "revise_draft", changes: {} }));
  });
});
