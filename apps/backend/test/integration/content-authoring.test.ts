import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createContentAuthoring,
  type CreateDraftCommand,
  type LoadDraftQuery,
  type ReviseDraftCommand,
} from "../../src/modules/materials/index.js";
import {
  fullRepresentativeDocument,
  representativeDocument,
} from "../fixtures/material-document/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const topicId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const formatId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const firstTagId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const secondTagId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const seriesId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

describe("ContentAuthoring", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.database
      .insertInto("topics")
      .values({ id: topicId, slug: "engineering", name: "Engineering" })
      .execute();
    await testDatabase.database
      .insertInto("formats")
      .values({ id: formatId, slug: "guide", name: "Guide" })
      .execute();
    await testDatabase.database
      .insertInto("tags")
      .values([
        { id: firstTagId, name: "Platform", normalized_name: "platform" },
        { id: secondTagId, name: "Delivery", normalized_name: "delivery" },
      ])
      .execute();
    await testDatabase.database
      .insertInto("series")
      .values({ id: seriesId, slug: "inside-platform", name: "Inside Platform" })
      .execute();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("rejects a malformed runtime command before policy or database work", async () => {
    let policyCalled = false;
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: {
        canAuthor: () => {
          policyCalled = true;
          return true;
        },
      },
    });

    expect(
      await authoring.createDraft(null as unknown as CreateDraftCommand),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "invalid_command", path: "" }],
      },
    });
    expect(
      await authoring.createDraft({
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
      } as CreateDraftCommand),
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
      await authoring.loadDraft(null as unknown as LoadDraftQuery),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "invalid_command", path: "" }],
      },
    });
    expect(
      await authoring.createDraft({
        actor,
        idempotencyKey: "bounded-metadata",
        metadata: {
          title: "",
          summary: "Summary",
          slug: "title",
          topicId,
          formatId,
          tagIds: [],
          seriesMemberships: [],
        },
        body: {},
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "invalid_metadata", path: "/title" }],
      },
    });
    expect(
      await authoring.reviseDraft({
        actor,
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
      } as ReviseDraftCommand),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "invalid_command", path: "/changes/body/0/to" }],
      },
    });
    expect(
      await authoring.reviseDraft({
        actor,
        idempotencyKey: "bounded-metadata-change",
        materialId: "94000000-0000-4000-8000-000000000002",
        baseRevisionId: "94000000-0000-4000-8000-000000000003",
        changes: { metadata: { title: "x".repeat(161) } },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "invalid_metadata", path: "/title" }],
      },
    });
    expect(policyCalled).toBe(false);
  });

  test("creates, loads and revises a representative draft through one interface", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: { canAuthor: (principalId) => principalId === actor },
    });
    const initialBody = fullRepresentativeDocument();
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
      metadata: {
        title: "Developer Pipeline",
        summary: "Один проверяемый delivery path.",
        slug: "developer-pipeline",
        topicId,
        formatId,
        tagIds: [firstTagId],
        seriesMemberships: [{ seriesId, ordinal: 5 }],
      },
      body: initialBody,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    expect(created.value).toMatchObject({
      metadata: {
        title: "Developer Pipeline",
        tagIds: [firstTagId],
        seriesMemberships: [{ seriesId, ordinal: 5 }],
      },
      body: initialBody,
    });

    const loaded = await authoring.loadDraft({
      actor: actor.toUpperCase(),
      materialId: created.value.materialId.toUpperCase(),
    });
    expect(loaded).toEqual({ ok: true, value: created.value });

    const revisedBody = representativeDocument("Issue хранит intent, revision хранит content.");
    const revised = await authoring.reviseDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000002",
      materialId: created.value.materialId,
      baseRevisionId: created.value.revisionId,
      changes: {
        metadata: {
          title: "Developer Pipeline: от issue до merge",
          tagIds: [firstTagId, secondTagId],
          seriesMemberships: [{ seriesId, ordinal: 6 }],
        },
        body: [{ kind: "replace_document", document: revisedBody }],
      },
    });

    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      throw new Error(revised.error.code);
    }
    expect(revised.value.revisionId).not.toBe(created.value.revisionId);
    expect(revised.value).toMatchObject({
      metadata: {
        title: "Developer Pipeline: от issue до merge",
        tagIds: [firstTagId, secondTagId],
        seriesMemberships: [{ seriesId, ordinal: 6 }],
      },
      body: revisedBody,
    });

    expect(
      await authoring.loadDraft({ actor, materialId: created.value.materialId }),
    ).toEqual({ ok: true, value: revised.value });
  });

  test("replays the original effect and rejects reuse of a key for another payload", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true },
    });
    const command = {
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000010",
      metadata: {
        title: "Idempotent draft",
        summary: "Повтор не создаёт второй effect.",
        slug: "idempotent-draft",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument(),
    } as const;

    const first = await authoring.createDraft(command);
    const replay = await authoring.createDraft(command);
    expect(replay).toEqual(first);

    if (!first.ok) {
      throw new Error(first.error.code);
    }
    const revised = await authoring.reviseDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000015",
      materialId: first.value.materialId,
      baseRevisionId: first.value.revisionId,
      changes: { metadata: { title: "A later revision" } },
    });
    expect(revised.ok).toBe(true);
    expect(await authoring.createDraft(command)).toEqual(first);

    const reused = await authoring.createDraft({
      ...command,
      metadata: { ...command.metadata, title: "Другой payload" },
    });
    expect(reused).toEqual({ ok: false, error: { code: "idempotency_key_reused" } });
  });

  test("assigns stable block IDs for create and replace-document inputs", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true },
    });
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000011",
      metadata: {
        title: "Assigned IDs",
        summary: "New server-side blocks receive stable IDs.",
        slug: "assigned-ids",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Created" }] },
          ],
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    expect(created.value.body).toMatchObject({
      doc: {
        content: [
          {
            attrs: { nodeId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
          },
        ],
      },
    });

    const revised = await authoring.reviseDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000012",
      materialId: created.value.materialId,
      baseRevisionId: created.value.revisionId,
      changes: {
        body: [
          {
            kind: "replace_document",
            document: {
              schemaVersion: 1,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "blockquote",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Replaced" }],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      throw new Error(revised.error.code);
    }
    expect(revised.value.body).toMatchObject({
      doc: {
        content: [
          {
            attrs: { nodeId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
            content: [
              {
                attrs: { nodeId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
              },
            ],
          },
        ],
      },
    });
  });

  test("treats different semantic requests with the same result as idempotency reuse", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true },
    });
    const body = representativeDocument();
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000013",
      metadata: {
        title: "Request fingerprint",
        summary: "The semantic request, not only its result, is fingerprinted.",
        slug: "request-fingerprint",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body,
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    const idempotencyKey = "10000000-0000-4000-8000-000000000014";
    const first = await authoring.reviseDraft({
      actor,
      idempotencyKey,
      materialId: created.value.materialId,
      baseRevisionId: created.value.revisionId,
      changes: { body: [{ kind: "replace_document", document: body }] },
    });
    expect(first.ok).toBe(true);

    expect(
      await authoring.reviseDraft({
        actor,
        idempotencyKey,
        materialId: created.value.materialId,
        baseRevisionId: created.value.revisionId,
        changes: { body: [] },
      }),
    ).toEqual({ ok: false, error: { code: "idempotency_key_reused" } });
  });

  test("allows one concurrent revision and returns the winner for the stale base", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true },
    });
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000020",
      metadata: {
        title: "Concurrent draft",
        summary: "Только один base может победить.",
        slug: "concurrent-draft",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument(),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    const [left, right] = await Promise.all([
      authoring.reviseDraft({
        actor,
        idempotencyKey: "10000000-0000-4000-8000-000000000021",
        materialId: created.value.materialId,
        baseRevisionId: created.value.revisionId,
        changes: { metadata: { title: "Left revision" } },
      }),
      authoring.reviseDraft({
        actor,
        idempotencyKey: "10000000-0000-4000-8000-000000000022",
        materialId: created.value.materialId,
        baseRevisionId: created.value.revisionId,
        changes: { metadata: { title: "Right revision" } },
      }),
    ]);
    const winner = [left, right].find((result) => result.ok);
    const stale = [left, right].find((result) => !result.ok);
    expect(winner?.ok).toBe(true);
    expect(stale).toEqual({
      ok: false,
      error: {
        code: "stale_revision",
        currentRevisionId: winner?.ok ? winner.value.revisionId : "missing",
      },
    });
    if (winner?.ok) {
      expect(
        await authoring.loadDraft({ actor, materialId: created.value.materialId }),
      ).toEqual({ ok: true, value: winner.value });
    }
  });

  test("collapses concurrent retries with the same idempotency key to one effect", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true },
    });
    const command = {
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000030",
      metadata: {
        title: "Concurrent retry",
        summary: "Один key — один effect.",
        slug: "concurrent-retry",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument(),
    } as const;

    const [left, right] = await Promise.all([
      authoring.createDraft(command),
      authoring.createDraft(command),
    ]);
    expect(left).toEqual(right);
    expect(left.ok).toBe(true);
  });

  test("rolls back an invalid revision and allows a corrected retry with the same key", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true },
    });
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "10000000-0000-4000-8000-000000000040",
      metadata: {
        title: "Rollback draft",
        summary: "Invalid change leaves current intact.",
        slug: "rollback-draft",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument(),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    const idempotencyKey = "10000000-0000-4000-8000-000000000041";

    const invalid = await authoring.reviseDraft({
      actor,
      idempotencyKey,
      materialId: created.value.materialId,
      baseRevisionId: created.value.revisionId,
      changes: {
        body: [
          {
            kind: "replace_document",
            document: {
              schemaVersion: 1,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "rawHtml",
                    attrs: {
                      nodeId: "10000000-0000-4000-8000-000000000099",
                      html: "<script>alert(1)</script>",
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "invalid_content" },
    });
    expect(
      await authoring.loadDraft({ actor, materialId: created.value.materialId }),
    ).toEqual({ ok: true, value: created.value });

    const corrected = await authoring.reviseDraft({
      actor,
      idempotencyKey,
      materialId: created.value.materialId,
      baseRevisionId: created.value.revisionId,
      changes: { metadata: { title: "Corrected revision" } },
    });
    expect(corrected.ok).toBe(true);
  });
});
