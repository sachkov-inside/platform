import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { readLearningPractice } from "../../src/modules/content-library/features/read-learning-practice/read-learning-practice.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const learner = {
  kind: "account" as const,
  accountId: accountId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
};
const topicId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const definition = {
  schemaVersion: 1 as const,
  title: "Synthetic brief",
  businessInputs:
    "A participant requests a consultation and sees their own request status.",
  expectedOutcome: "Explain requirements and uncertainties.",
  allowedFreedom: "Any document format or architecture.",
  criteria: [
    {
      id: "ownership",
      requirement: "One participant cannot see another participant's requests.",
      acceptableEvidence: ["Explicit requirement with its business reason."],
    },
  ],
};

describe("published learning practice", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.topic.create({
      data: { id: topicId, slug: "practice", name: "Practice" },
    });
  });
  afterAll(async () => database.dispose());

  async function fixture() {
    const id = randomUUID();
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (actor) => actor === owner },
    });
    const source = {
      id: `synthetic:lesson-${id}`,
      path: `lessons/${id}.md`,
      revision: "a".repeat(64),
      showInFeed: false,
    };
    const reserved = await materials.authoring.reserveSourceMaterial({
      actor: owner,
      source,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const applied = await materials.authoring.applySourceMaterial({
      actor: owner,
      idempotencyKey: `lesson-${id}`,
      source,
      materialId: reserved.value.materialId,
      expectedContentVersion: reserved.value.contentVersion,
      publicationState: "published",
      primaryVideoId: null,
      metadata: {
        title: `Practice ${id}`,
        summary: "Synthetic reference lesson",
        access: "free",
        topicId,
        formatId: "guide",
        tagIds: [],
        seriesIds: [],
        difficulty: null,
        outcomes: [],
      },
      body: representativeDocument(
        "Full reference lesson: identify the business requirement, its reason and a way to observe it. Alternative designs are valid. Do not invent missing business facts.",
      ),
    });
    if (!applied.ok) throw new Error(applied.error.code);
    const command = {
      actor: owner,
      idempotencyKey: `practice-${id}`,
      practiceId: `synthetic:practice-${id}`,
      materialId: applied.value.materialId,
      expectedContentVersion: applied.value.contentVersion,
      expectedPracticeVersion: null,
      definition,
      publicationState: "published" as const,
      sourceReference: {
        materialSourceId: source.id,
        materialSourceRevision: source.revision,
      },
      provenance: {
        repository: "synthetic/fixtures",
        commit: "b".repeat(40),
        path: `practices/${id}.json`,
      },
    };
    return { materials, command };
  }

  test("authorizes import, preserves an idempotent receipt, and rejects reused keys", async () => {
    const { materials, command } = await fixture();
    expect(
      await materials.authoring.applySourcePractice({
        ...command,
        actor: learner.accountId,
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const first = await materials.authoring.applySourcePractice(command);
    expect(first).toMatchObject({ ok: true, value: { practiceVersion: 1 } });
    expect(await materials.authoring.applySourcePractice(command)).toEqual(
      first,
    );
    expect(
      await materials.authoring.applySourcePractice({
        ...command,
        definition: { ...definition, title: "Changed" },
      }),
    ).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
    expect(
      await database.prisma.practiceDefinition.count({
        where: { practiceId: command.practiceId },
      }),
    ).toBe(1);
  });

  test("withdrawal and ABA reject an old republish; a historical receipt does not republish", async () => {
    const { materials, command } = await fixture();
    const initial = await materials.authoring.applySourcePractice(command);
    expect(initial.ok).toBe(true);
    const withdraw = {
      ...command,
      idempotencyKey: randomUUID(),
      expectedPracticeVersion: 1,
      publicationState: "unpublished" as const,
    };
    expect(
      await materials.authoring.applySourcePractice(withdraw),
    ).toMatchObject({ ok: true, value: { practiceVersion: 2 } });
    expect(
      await materials.authoring.applySourcePractice({
        ...command,
        idempotencyKey: randomUUID(),
        expectedPracticeVersion: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "practice_version_conflict" },
    });
    expect(await materials.authoring.applySourcePractice(command)).toEqual(
      initial,
    );
    expect(
      await materials.publishedMaterialReader.readPractice({
        subject: learner,
        practiceId: command.practiceId,
      }),
    ).toMatchObject({ ok: false, error: { code: "practice_not_available" } });
    expect(
      await materials.authoring.applySourcePractice({
        ...command,
        idempotencyKey: randomUUID(),
        expectedPracticeVersion: 2,
      }),
    ).toMatchObject({ ok: true, value: { practiceVersion: 3 } });
    expect(
      await materials.authoring.applySourcePractice({
        ...withdraw,
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "practice_version_conflict" },
    });
  });

  test("one concurrent stale apply wins and the other rolls back its receipt", async () => {
    const { materials, command } = await fixture();
    await materials.authoring.applySourcePractice(command);
    const results = await Promise.all(
      ["First", "Second"].map((title) =>
        materials.authoring.applySourcePractice({
          ...command,
          expectedPracticeVersion: 1,
          idempotencyKey: randomUUID(),
          definition: { ...definition, title },
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: { code: "practice_version_conflict" } },
    ]);
    expect(
      await database.prisma.practiceImportReceipt.count({
        where: {
          receipt: { path: ["practiceId"], equals: command.practiceId },
        },
      }),
    ).toBe(2);
  });

  test("denies anonymous and revoked readers without protected criteria or body", async () => {
    const { materials, command } = await fixture();
    await materials.authoring.applySourcePractice(command);
    const anonymous = await materials.publishedMaterialReader.readPractice({
      subject: { kind: "anonymous" },
      practiceId: command.practiceId,
    });
    expect(anonymous).toEqual({
      ok: false,
      error: { code: "practice_not_available" },
    });
    const denied = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => false },
      contentAccess: {
        ...materials.contentAccess,
        authorize: () =>
          Promise.resolve({
            effect: "deny",
            reason: "membership_expired",
            decisionId: "test",
            policyVersion: "content-access-v1",
            decidedAt: new Date().toISOString(),
          }),
      },
    });
    expect(
      await denied.publishedMaterialReader.readPractice({
        subject: learner,
        practiceId: command.practiceId,
      }),
    ).toEqual(anonymous);
  });

  test("rejects stale source binding and never substitutes a newer lesson", async () => {
    const { materials, command } = await fixture();
    expect(
      await materials.authoring.applySourcePractice({
        ...command,
        sourceReference: {
          ...command.sourceReference,
          materialSourceRevision: "f".repeat(64),
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "source_mismatch" } });
    await materials.authoring.applySourcePractice(command);
    const loaded = await materials.authoring.loadMaterial({
      actor: owner,
      materialId: command.materialId,
    });
    if (!loaded.ok || loaded.value.source === undefined)
      throw new Error("Expected imported fixture");
    const {
      slug: _slug,
      seriesMemberships,
      ...metadata
    } = loaded.value.metadata;
    const changed = await materials.authoring.applySourceMaterial({
      actor: owner,
      idempotencyKey: randomUUID(),
      materialId: command.materialId,
      expectedContentVersion: command.expectedContentVersion,
      publicationState: "published",
      primaryVideoId: null,
      source: { ...loaded.value.source, revision: "c".repeat(64) },
      metadata: {
        ...metadata,
        outcomes: [...metadata.outcomes],
        tagIds: [...metadata.tagIds],
        formatId: "guide",
        title: "New lesson version",
        seriesIds: seriesMemberships.map((entry) => entry.seriesId),
      },
      body: representativeDocument("Changed reference lesson"),
    });
    expect(changed.ok).toBe(true);
    expect(
      await materials.publishedMaterialReader.readPractice({
        subject: learner,
        practiceId: command.practiceId,
      }),
    ).toEqual({
      ok: false,
      error: { code: "practice_context_unavailable", reason: "source_changed" },
    });
  });

  test("rejects withdrawal between context and full lesson reads", async () => {
    const { materials, command } = await fixture();
    await materials.authoring.applySourcePractice(command);
    const result = await readLearningPractice(
      {
        contentAccess: materials.contentAccess,
        reader: {
          ...materials.publishedMaterialReader,
          read: async (query) => {
            const body = await materials.publishedMaterialReader.read(query);
            await materials.authoring.applySourcePractice({
              ...command,
              idempotencyKey: randomUUID(),
              expectedPracticeVersion: 1,
              publicationState: "unpublished",
            });
            return body;
          },
        },
      },
      { subject: learner, practiceId: command.practiceId },
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "practice_not_available" },
    });
  });

  test("imports without holding a second pooled connection", async () => {
    const { command } = await fixture();
    await withExhaustedPool(database, async (prisma) => {
      const { authoring } = assembleMaterials({
        prisma,
        authorPolicy: { canManage: () => true },
      });
      expect(await authoring.applySourcePractice(command)).toMatchObject({
        ok: true,
        value: { practiceVersion: 1 },
      });
    });
  });
});
