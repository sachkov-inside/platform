import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  anonymousSubject,
  createBaselineContentAccess,
  createMaterials,
} from "../../src/modules/materials/index.js";
import {
  fullRepresentativeDocument,
  representativeDocument,
} from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  notStringMatching,
  stringMatching,
} from "../support/matchers.js";

const ownerId = "71000000-0000-4000-8000-000000000001";
const topicId = "71000000-0000-4000-8000-000000000002";
const formatId = "71000000-0000-4000-8000-000000000003";
const denyAllAuthorPolicy = {
  canAuthor: () => false,
  canPublish: () => false,
};

describe("Material lifecycle", () => {
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
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("validates, previews, publishes and publicly reads one exact free revision", async () => {
    const authorPolicy = {
      canAuthor: (principalId: string) => principalId === ownerId,
      canPublish: ({ principalId }: { principalId: string }) =>
        principalId === ownerId,
    };
    const contentAccess = createBaselineContentAccess(authorPolicy);
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy,
      contentAccess,
    });
    let readAuthorizationCalls = 0;
    const { publishedMaterialReader: publishedMaterials } = createMaterials({
      database: testDatabase.database,
      authorPolicy: denyAllAuthorPolicy,
      contentAccess: {
        authorize: (request) => {
          readAuthorizationCalls += 1;
          return contentAccess.authorize(request);
        },
      },
    });
    const body = representativeDocument("Exact published content.");
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000010",
      metadata: {
        title: "Public lifecycle",
        summary: "Exact preview and published read.",
        slug: "public-lifecycle",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    const validated = await authoring.validateRevision({
      actor: ownerId,
      materialId: created.value.materialId,
      revisionId: created.value.revisionId,
    });
    expect(validated).toMatchObject({
      ok: true,
      value: {
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
        projectionDigest: stringMatching(/^[0-9a-f]{64}$/),
      },
    });

    const preview = await authoring.previewRevision({
      actor: ownerId,
      materialId: created.value.materialId,
      revisionId: created.value.revisionId,
    });
    expect(preview).toMatchObject({
      ok: true,
      value: {
        revisionId: created.value.revisionId,
        cacheScope: "private-no-store",
        body: {
          blocks: [
            { kind: "heading", level: 2 },
            {
              kind: "paragraph",
              content: [{ kind: "text", text: "Exact published content." }],
            },
          ],
        },
      },
    });
    expect(
      await testDatabase.database
        .selectFrom("material_access_audit_events")
        .select(["action", "actor_id", "decision", "material_id", "revision_id"])
        .where("material_id", "=", created.value.materialId)
        .execute(),
    ).toEqual([
      {
        action: "preview",
        actor_id: ownerId,
        decision: "allow",
        material_id: created.value.materialId,
        revision_id: created.value.revisionId,
      },
    ]);

    const published = await authoring.publishRevision({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000011",
      materialId: created.value.materialId,
      revisionId: created.value.revisionId,
      expectedPublishedRevisionId: null,
    });
    expect(published).toMatchObject({
      ok: true,
      value: {
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
        publicationEventId: stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    if (!published.ok) {
      throw new Error(published.error.code);
    }
    expect(
      await testDatabase.database
        .selectFrom("material_publication_events")
        .select(["material_id", "revision_id", "kind", "actor_id", "created_at"])
        .where("id", "=", published.value.publicationEventId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      material_id: created.value.materialId,
      revision_id: created.value.revisionId,
      kind: "publish",
      actor_id: ownerId,
      created_at: published.value.recordedAt,
    });
    await expect(
      testDatabase.database
        .updateTable("material_publication_events")
        .set({ actor_id: topicId })
        .where("id", "=", published.value.publicationEventId)
        .execute(),
    ).rejects.toMatchObject({ code: "55000" });
    expect(
      await authoring.publishRevision({
        actor: ownerId,
        idempotencyKey: "71000000-0000-4000-8000-000000000011",
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
        expectedPublishedRevisionId: null,
      }),
    ).toEqual(published);
    expect(
      await authoring.publishRevision({
        actor: ownerId,
        idempotencyKey: "71000000-0000-4000-8000-000000000011",
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
        expectedPublishedRevisionId: created.value.revisionId,
      }),
    ).toEqual({ ok: false, error: { code: "idempotency_key_reused" } });

    expect(
      await publishedMaterials.read({
        subject: anonymousSubject,
        slug: "public-lifecycle",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "available",
        cacheScope: "public",
        projection: {
          materialId: created.value.materialId,
          revisionId: created.value.revisionId,
          title: "Public lifecycle",
          access: "free",
        },
        body: preview.ok ? preview.value.body : undefined,
      },
    });
    expect(readAuthorizationCalls).toBe(1);
  });

  test("restores an historical revision as a new draft and unpublishes without losing history", async () => {
    const authorPolicy = {
      canAuthor: (principalId: string) => principalId === ownerId,
      canPublish: ({ principalId }: { principalId: string }) =>
        principalId === ownerId,
    };
    const contentAccess = createBaselineContentAccess(authorPolicy);
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy,
      contentAccess,
    });
    const { publishedMaterialReader: publishedMaterials } = createMaterials({
      database: testDatabase.database,
      authorPolicy: denyAllAuthorPolicy,
      contentAccess,
    });
    const original = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000020",
      metadata: {
        title: "Restore lifecycle",
        summary: "History remains immutable.",
        slug: "restore-lifecycle",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: fullRepresentativeDocument(),
    });
    if (!original.ok) {
      throw new Error(original.error.code);
    }
    const firstPublication = await authoring.publishRevision({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000021",
      materialId: original.value.materialId,
      revisionId: original.value.revisionId,
      expectedPublishedRevisionId: null,
    });
    if (!firstPublication.ok) {
      throw new Error(firstPublication.error.code);
    }
    const revised = await authoring.reviseDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000022",
      materialId: original.value.materialId,
      baseRevisionId: original.value.revisionId,
      changes: {
        body: [
          {
            kind: "replace_document",
            document: representativeDocument("Later revision."),
          },
        ],
      },
    });
    if (!revised.ok) {
      throw new Error(revised.error.code);
    }
    expect(
      await authoring.validateRevision({
        actor: ownerId,
        materialId: original.value.materialId,
        revisionId: original.value.revisionId,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "stale_revision",
        currentRevisionId: revised.value.revisionId,
      },
    });

    const restoreCommands = [
      "71000000-0000-4000-8000-000000000023",
      "71000000-0000-4000-8000-000000000025",
    ].map((idempotencyKey) => ({
      actor: ownerId,
      idempotencyKey,
      materialId: original.value.materialId,
      revisionId: original.value.revisionId,
      baseRevisionId: revised.value.revisionId,
    }));
    const restoreResults = await Promise.all(
      restoreCommands.map((command) => authoring.restoreRevision(command)),
    );
    expect(restoreResults.filter((result) => result.ok)).toHaveLength(1);
    const restoredIndex = restoreResults.findIndex((result) => result.ok);
    const restored = restoreResults[restoredIndex];
    if (restored === undefined || !restored.ok) {
      throw new Error("Expected one successful restore");
    }
    const restoreCommand = restoreCommands[restoredIndex];
    if (restoreCommand === undefined) {
      throw new Error("Expected a command for the successful restore");
    }
    expect(restoreResults[restoredIndex === 0 ? 1 : 0]).toEqual({
      ok: false,
      error: {
        code: "stale_revision",
        currentRevisionId: restored.value.revisionId,
      },
    });
    expect(
      await authoring.restoreRevision(restoreCommand),
    ).toEqual(restored);
    expect(restored).toMatchObject({
      ok: true,
      value: {
        materialId: original.value.materialId,
        revisionId: notStringMatching(original.value.revisionId),
        body: original.value.body,
      },
    });
    expect(
      await testDatabase.database
        .selectFrom("material_revisions")
        .select("restored_from_revision_id")
        .where("id", "=", restored.value.revisionId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ restored_from_revision_id: original.value.revisionId });
    expect(
      await publishedMaterials.read({ subject: anonymousSubject, slug: "restore-lifecycle" }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "available",
        projection: { revisionId: original.value.revisionId },
      },
    });

    const unpublishCommands = [
      "71000000-0000-4000-8000-000000000024",
      "71000000-0000-4000-8000-000000000026",
    ].map((idempotencyKey) => ({
      actor: ownerId,
      idempotencyKey,
      materialId: original.value.materialId,
      expectedPublishedRevisionId: original.value.revisionId,
    }));
    const unpublishResults = await Promise.all(
      unpublishCommands.map((command) => authoring.unpublishMaterial(command)),
    );
    expect(unpublishResults.filter((result) => result.ok)).toHaveLength(1);
    const unpublishedIndex = unpublishResults.findIndex((result) => result.ok);
    const unpublished = unpublishResults[unpublishedIndex];
    if (unpublished === undefined || !unpublished.ok) {
      throw new Error("Expected one successful unpublish");
    }
    const unpublishCommand = unpublishCommands[unpublishedIndex];
    if (unpublishCommand === undefined) {
      throw new Error("Expected a command for the successful unpublish");
    }
    expect(unpublishResults[unpublishedIndex === 0 ? 1 : 0]).toEqual({
      ok: false,
      error: { code: "stale_publication", currentPublishedRevisionId: null },
    });
    expect(unpublished).toMatchObject({
      ok: true,
      value: {
        materialId: original.value.materialId,
        revisionId: original.value.revisionId,
        publicationEventId: stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    expect(
      await authoring.unpublishMaterial(unpublishCommand),
    ).toEqual(unpublished);
    expect(
      await publishedMaterials.read({ subject: anonymousSubject, slug: "restore-lifecycle" }),
    ).toEqual({ ok: false, error: { code: "material_not_found" } });

    const historicalPreview = await authoring.previewRevision({
      actor: ownerId,
      materialId: original.value.materialId,
      revisionId: original.value.revisionId,
    });
    expect(historicalPreview).toMatchObject({
      ok: true,
      value: { revisionId: original.value.revisionId },
    });
  });

  test("returns a safe teaser without loading a closed body when access is unavailable", async () => {
    const materialId = "71000000-0000-4000-8000-000000000030";
    const revisionId = "71000000-0000-4000-8000-000000000031";
    await testDatabase.database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("materials")
        .values({
          id: materialId,
          slug: "closed-corrupt-body",
          current_draft_revision_id: revisionId,
          current_published_revision_id: null,
        })
        .execute();
      await transaction
        .insertInto("material_revisions")
        .values({
          id: revisionId,
          material_id: materialId,
          title: "Closed safe teaser",
          summary: "The public projection remains available.",
          slug: "closed-corrupt-body",
          access: "membership",
          topic_id: topicId,
          format_id: formatId,
          schema_version: 1,
          body: { type: "rawHtml", html: "<script>private()</script>" },
          created_by: ownerId,
          restored_from_revision_id: null,
        })
        .execute();
      await transaction
        .insertInto("published_materials")
        .values({
          material_id: materialId,
          revision_id: revisionId,
          slug: "closed-corrupt-body",
          title: "Closed safe teaser",
          summary: "The public projection remains available.",
          access: "membership",
          topic_id: topicId,
          format_id: formatId,
          published_by: ownerId,
        })
        .execute();
      await transaction
        .updateTable("materials")
        .set({ current_published_revision_id: revisionId })
        .where("id", "=", materialId)
        .execute();
    });
    const { publishedMaterialReader: publishedMaterials } = createMaterials({
      database: testDatabase.database,
      authorPolicy: denyAllAuthorPolicy,
      contentAccess: {
        authorize: () => {
          throw new Error("Membership dependency unavailable");
        },
      },
    });

    const result = await publishedMaterials.read({
      subject: anonymousSubject,
      slug: "closed-corrupt-body",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "teaser",
        cacheScope: "public",
        projection: {
          materialId,
          revisionId,
          slug: "closed-corrupt-body",
          title: "Closed safe teaser",
          summary: "The public projection remains available.",
          access: "membership",
          publishedAt: stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          topic: { id: topicId, name: "Engineering", slug: "engineering" },
          format: { id: formatId, name: "Guide", slug: "guide" },
          tags: [],
          seriesMemberships: [],
        },
        access: { allowed: false, reason: "temporarily_unavailable" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("private()");
    expect(
      await testDatabase.database
        .selectFrom("material_access_audit_events")
        .select(["action", "actor_id", "decision"])
        .where("material_id", "=", materialId)
        .execute(),
    ).toEqual([{ action: "read", actor_id: null, decision: "deny" }]);
  });

  test("loads an exact membership body only after an explicit allow decision", async () => {
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true, canPublish: () => true },
    });
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000090",
      metadata: {
        title: "Membership delivery",
        summary: "Protected bytes require an allow decision.",
        slug: "membership-delivery",
        access: "membership",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument("Allowed membership body."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    const published = await authoring.publishRevision({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000091",
      materialId: created.value.materialId,
      revisionId: created.value.revisionId,
      expectedPublishedRevisionId: null,
    });
    if (!published.ok) {
      throw new Error(published.error.code);
    }
    const decisions: unknown[] = [];
    const { publishedMaterialReader: publishedMaterials } = createMaterials({
      database: testDatabase.database,
      authorPolicy: denyAllAuthorPolicy,
      contentAccess: {
        authorize: (request) => {
          decisions.push(request);
          return Promise.resolve({ allowed: true, reason: "author" });
        },
      },
    });

    expect(
      await publishedMaterials.read({
        subject: { kind: "principal", principalId: ownerId },
        slug: "membership-delivery",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "available",
        cacheScope: "private-no-store",
        projection: { revisionId: created.value.revisionId, access: "membership" },
        body: {
          blocks: [
            { kind: "heading", level: 2 },
            {
              kind: "paragraph",
              content: [{ kind: "text", text: "Allowed membership body." }],
            },
          ],
        },
      },
    });
    expect(decisions).toEqual([
      {
        subject: { kind: "principal", principalId: ownerId },
        action: "read",
        resource: {
          kind: "material_body",
          materialId: created.value.materialId,
          revisionId: created.value.revisionId,
          publication: "published",
          access: "membership",
        },
      },
    ]);
    expect(
      await testDatabase.database
        .selectFrom("material_access_audit_events")
        .select(["action", "actor_id", "decision"])
        .where("material_id", "=", created.value.materialId)
        .execute(),
    ).toEqual([{ action: "read", actor_id: ownerId, decision: "allow" }]);
  });

  test("requires a distinct owner permission before recording publication GO", async () => {
    const publishAuthorizationRequests: unknown[] = [];
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy: {
        canAuthor: (principalId: string) => principalId === ownerId,
        canPublish: (request) => {
          publishAuthorizationRequests.push(request);
          return false;
        },
      },
    });
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000040",
      metadata: {
        title: "Prepared by an author",
        summary: "Publication still requires owner GO.",
        slug: "owner-go-required",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument("Prepared, not published."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    expect(
      await authoring.publishRevision({
        actor: ownerId,
        idempotencyKey: "71000000-0000-4000-8000-000000000041",
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
        expectedPublishedRevisionId: null,
      }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(publishAuthorizationRequests).toEqual([
      {
        action: "publish",
        principalId: ownerId,
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
      },
    ]);
    expect(
      await testDatabase.database
        .selectFrom("material_publication_events")
        .select("id")
        .where("material_id", "=", created.value.materialId)
        .execute(),
    ).toEqual([]);
  });

  test("distinguishes an unknown revision from a stale existing revision", async () => {
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true, canPublish: () => true },
    });
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000042",
      metadata: {
        title: "Publish revision errors",
        summary: "Unknown and stale revisions have distinct outcomes.",
        slug: "publish-revision-errors",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument("Current draft."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    expect(
      await authoring.publishRevision({
        actor: ownerId,
        idempotencyKey: "71000000-0000-4000-8000-000000000043",
        materialId: created.value.materialId,
        revisionId: "71000000-0000-4000-8000-000000000099",
        expectedPublishedRevisionId: null,
      }),
    ).toEqual({ ok: false, error: { code: "revision_not_found" } });

    const revised = await authoring.reviseDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000044",
      materialId: created.value.materialId,
      baseRevisionId: created.value.revisionId,
      changes: { body: [{ kind: "replace_document", document: representativeDocument("New draft.") }] },
    });
    if (!revised.ok) {
      throw new Error(revised.error.code);
    }
    expect(
      await authoring.publishRevision({
        actor: ownerId,
        idempotencyKey: "71000000-0000-4000-8000-000000000045",
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
        expectedPublishedRevisionId: null,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "stale_revision",
        currentRevisionId: revised.value.revisionId,
      },
    });
  });

  test("serializes concurrent publish commands and rejects the stale contender", async () => {
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true, canPublish: () => true },
    });
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000050",
      metadata: {
        title: "Concurrent publication",
        summary: "One owner command wins the Material lock.",
        slug: "concurrent-publication",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument("Publish exactly once."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    const publish = (idempotencyKey: string) =>
      authoring.publishRevision({
        actor: ownerId,
        idempotencyKey,
        materialId: created.value.materialId,
        revisionId: created.value.revisionId,
        expectedPublishedRevisionId: null,
      });

    const results = await Promise.all([
      publish("71000000-0000-4000-8000-000000000051"),
      publish("71000000-0000-4000-8000-000000000052"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      error: {
        code: "stale_publication",
        currentPublishedRevisionId: created.value.revisionId,
      },
    });
    expect(
      await testDatabase.database
        .selectFrom("material_publication_events")
        .select("id")
        .where("material_id", "=", created.value.materialId)
        .execute(),
    ).toHaveLength(1);
  });

  test("rolls back every publication fact when a projection constraint fails", async () => {
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true, canPublish: () => true },
    });
    const first = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000060",
      metadata: {
        title: "First slug owner",
        summary: "Keeps the public projection slug occupied.",
        slug: "publication-rollback",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument("First published body."),
    });
    if (!first.ok) {
      throw new Error(first.error.code);
    }
    const firstPublication = await authoring.publishRevision({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000061",
      materialId: first.value.materialId,
      revisionId: first.value.revisionId,
      expectedPublishedRevisionId: null,
    });
    if (!firstPublication.ok) {
      throw new Error(firstPublication.error.code);
    }
    const renamedDraft = await authoring.reviseDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000062",
      materialId: first.value.materialId,
      baseRevisionId: first.value.revisionId,
      changes: { metadata: { slug: "publication-rollback-renamed" } },
    });
    if (!renamedDraft.ok) {
      throw new Error(renamedDraft.error.code);
    }
    const contender = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000063",
      metadata: {
        title: "Projection contender",
        summary: "Its draft slug is valid but its publication conflicts.",
        slug: "publication-rollback",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument("Contender private body."),
    });
    if (!contender.ok) {
      throw new Error(contender.error.code);
    }
    const failedCommand = {
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000064",
      materialId: contender.value.materialId,
      revisionId: contender.value.revisionId,
      expectedPublishedRevisionId: null,
    } as const;

    expect(await authoring.publishRevision(failedCommand)).toEqual({
      ok: false,
      error: { code: "slug_conflict", slug: "publication-rollback" },
    });
    expect(
      await testDatabase.database
        .selectFrom("materials")
        .select("current_published_revision_id")
        .where("id", "=", contender.value.materialId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ current_published_revision_id: null });
    expect(
      await testDatabase.database
        .selectFrom("published_materials")
        .select("material_id")
        .where("material_id", "=", contender.value.materialId)
        .execute(),
    ).toEqual([]);
    expect(
      await testDatabase.database
        .selectFrom("material_publication_events")
        .select("id")
        .where("material_id", "=", contender.value.materialId)
        .execute(),
    ).toEqual([]);
    expect(
      await testDatabase.database
        .selectFrom("authoring_idempotency")
        .select("idempotency_key")
        .where("idempotency_key", "=", failedCommand.idempotencyKey)
        .execute(),
    ).toEqual([]);

    const unpublished = await authoring.unpublishMaterial({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000065",
      materialId: first.value.materialId,
      expectedPublishedRevisionId: first.value.revisionId,
    });
    if (!unpublished.ok) {
      throw new Error(unpublished.error.code);
    }
    expect(await authoring.publishRevision(failedCommand)).toMatchObject({
      ok: true,
      value: {
        materialId: contender.value.materialId,
        revisionId: contender.value.revisionId,
      },
    });
  });

  test("replaces the published search projection when a newer revision is published", async () => {
    const { authoring } = createMaterials({
      database: testDatabase.database,
      authorPolicy: { canAuthor: () => true, canPublish: () => true },
    });
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000070",
      metadata: {
        title: "Direct republish",
        summary: "Replaces every public projection atomically.",
        slug: "direct-republish",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument("First searchable body."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    const firstPublication = await authoring.publishRevision({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000071",
      materialId: created.value.materialId,
      revisionId: created.value.revisionId,
      expectedPublishedRevisionId: null,
    });
    if (!firstPublication.ok) {
      throw new Error(firstPublication.error.code);
    }
    const revised = await authoring.reviseDraft({
      actor: ownerId,
      idempotencyKey: "71000000-0000-4000-8000-000000000092",
      materialId: created.value.materialId,
      baseRevisionId: created.value.revisionId,
      changes: {
        body: [
          {
            kind: "replace_document",
            document: representativeDocument("Second searchable body."),
          },
        ],
      },
    });
    if (!revised.ok) {
      throw new Error(revised.error.code);
    }

    expect(
      await authoring.publishRevision({
        actor: ownerId,
        idempotencyKey: "71000000-0000-4000-8000-000000000093",
        materialId: created.value.materialId,
        revisionId: revised.value.revisionId,
        expectedPublishedRevisionId: created.value.revisionId,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        materialId: created.value.materialId,
        revisionId: revised.value.revisionId,
      },
    });
    expect(
      await testDatabase.database
        .selectFrom("material_search_documents")
        .select(["revision_id", "plain_text"])
        .where("material_id", "=", created.value.materialId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      revision_id: revised.value.revisionId,
      plain_text: "Developer Pipeline\n\nSecond searchable body.",
    });
  });
});
