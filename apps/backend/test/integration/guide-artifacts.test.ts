import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type {
  ObjectStorage,
  ObjectStorageNamespace,
} from "../../src/infrastructure/object-storage/index.js";
import { accountId, assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type ContentAccess,
} from "../../src/modules/content-access/index.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
  type AccessCapability,
} from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import {
  assembleGuideArtifactDelivery,
  assembleGuideArtifactResourceFacts,
  assembleGuideArtifacts,
  assembleMaterialResourceFacts,
  assembleMaterials,
  type GuideArtifactDelivery,
  type GuideArtifacts,
} from "../../src/modules/materials/index.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const owner = randomUUID();
const member = randomUUID();
const guideA = randomUUID();
const guideB = randomUUID();
const topicId = randomUUID();

// Every artifact read and write uses production facets over real PostgreSQL and
// a controlled object storage double. No real purchase, publication or upload
// leaves this test database.
describe("Guide Artifacts", () => {
  let db: TestDatabase;
  let artifacts: GuideArtifacts;
  let delivery: GuideArtifactDelivery;
  let contentAccess: ContentAccess;
  let grants: ReturnType<typeof assembleAccessGrants>;
  const stored = new Map<string, { body: Uint8Array; contentType: string }>();
  const writes: { key: string; namespace: ObjectStorageNamespace }[] = [];
  const deletes: { key: string; namespace: ObjectStorageNamespace }[] = [];
  const signed: Parameters<ObjectStorage["signGet"]>[0][] = [];
  const objectStorage: ObjectStorage = {
    delete: (namespace, key) => {
      deletes.push({ key, namespace });
      stored.delete(storageKey(namespace, key));
      return Promise.resolve();
    },
    putImmutable: (input) => {
      const key = storageKey(input.namespace, input.key);
      if (stored.has(key)) {
        return Promise.resolve({
          error: { code: "object_already_exists" as const },
          ok: false as const,
        });
      }
      stored.set(key, { body: input.body, contentType: input.contentType });
      writes.push({ key: input.key, namespace: input.namespace });
      return Promise.resolve({ ok: true as const });
    },
    read: (namespace, key) => {
      const object = stored.get(storageKey(namespace, key));
      return Promise.resolve(
        object === undefined
          ? null
          : {
              body: object.body,
              checksumSha256: sha256(object.body),
              contentLength: object.body.byteLength,
              contentType: object.contentType,
            },
      );
    },
    signGet: (input) => {
      signed.push(input);
      return Promise.resolve(`https://storage.test/${input.key}`);
    },
  };

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, member]) {
      await db.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
      });
    }
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    await db.prisma.topic.create({
      data: { id: topicId, name: "Synthetic artifacts", slug: "artifact-topic" },
    });
    for (const id of [guideA, guideB]) {
      await db.prisma.guide.create({
        data: { id, name: `Synthetic guide ${id}`, slug: id },
      });
    }
    const accounts = assembleAccounts({
      emailFingerprintKey: "synthetic-guide-artifact-fingerprint-key",
      prisma: db.prisma,
    });
    grants = assembleAccessGrants({ accounts, prisma: db.prisma });
    const membershipEntitlements = assembleMembershipEntitlements({
      prisma: db.prisma,
      workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma }),
    });
    artifacts = assembleGuideArtifacts({
      authorPolicy: { canManage: (id) => id === owner },
      objectStorage,
      prisma: db.prisma,
    });
    const materials = assembleMaterials({
      authorPolicy: { canManage: (id) => id === owner },
      prisma: db.prisma,
    });
    contentAccess = assembleContentAccess({
      accountPermissions: {
        hasMaterialsManage: (id) => Promise.resolve(id === owner),
      },
      guideArtifactResourceFacts: assembleGuideArtifactResourceFacts(artifacts),
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      membershipEntitlements,
    });
    delivery = assembleGuideArtifactDelivery({
      artifacts,
      contentAccess,
      objectStorage,
      signedGetTtlSeconds: 60,
    });
  });

  afterAll(async () => {
    await db.dispose();
  });

  test("keeps one artifact record while two guides reuse it and a new file version replaces the old one", async () => {
    const created = await artifacts.create({
      actor: owner,
      file: fileUpload("checklist.md", "# Release checklist\n- one\n"),
      guideId: guideA,
      kind: "file",
      metadata: {
        access: "free",
        purpose: "Проверка перед выпуском",
        title: "Чек-лист выпуска",
      },
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        access: "free",
        archived: false,
        content: { filename: "checklist.md", kind: "file" },
        guideIds: [guideA],
        origin: "platform",
        sourceId: null,
        version: 1,
      },
    });
    if (!created.ok) throw new Error("artifact creation failed");
    const artifactId = created.value.artifactId;

    // Quarantine holds the untrusted upload first, protected and public copies
    // follow, and only the quarantine object is forgotten once ready.
    const namespaces = writes
      .filter(({ key }) => key.includes(artifactId))
      .map(({ namespace }) => namespace);
    expect(namespaces).toEqual(["quarantine", "protected", "public"]);
    expect(
      deletes.filter(({ key }) => key.includes(artifactId)),
    ).toEqual([
      expect.objectContaining({ namespace: "quarantine" }),
    ]);

    const placed = await artifacts.setGuides({
      actor: owner,
      artifactId,
      guideIds: [guideA, guideB],
    });
    expect(placed).toMatchObject({ ok: true });
    for (const guideId of [guideA, guideB]) {
      const listed = await artifacts.listForGuide({ actor: owner, guideId });
      expect(listed.ok && listed.value.map((item) => item.artifactId)).toEqual([
        artifactId,
      ]);
    }
    expect(await db.prisma.guideArtifact.count()).toBe(1);

    const replaced = await artifacts.replaceContent({
      actor: owner,
      artifactId,
      file: fileUpload("checklist.md", "# Release checklist\n- one\n- two\n"),
      kind: "file",
    });
    expect(replaced).toMatchObject({
      ok: true,
      value: { artifactId, guideIds: [guideA, guideB], version: 2 },
    });
    expect(
      await db.prisma.guideArtifactVersion.count({ where: { artifactId } }),
    ).toBe(2);
    const previous = await db.prisma.guideArtifactVersion.findUniqueOrThrow({
      where: { artifactId_version: { artifactId, version: 1 } },
    });
    expect(previous.supersededAt).not.toBeNull();
  });

  test("refuses an executable upload and creates no artifact", async () => {
    const before = await db.prisma.guideArtifact.count();
    const rejected = await artifacts.create({
      actor: owner,
      file: fileUpload("setup.sh", "#!/bin/sh\necho install\n", "text/x-shellscript"),
      guideId: guideA,
      kind: "file",
      metadata: { access: "free", purpose: "", title: "Установщик" },
    });
    expect(rejected).toEqual({
      error: { code: "invalid_content", reason: "executable_content" },
      ok: false,
    });
    expect(await db.prisma.guideArtifact.count()).toBe(before);
  });

  test("delivers a free artifact to a visitor and a membership artifact only to a granted account", async () => {
    const free = await createArtifact("free", "Публичный шаблон", guideA);
    const paid = await createArtifact("membership", "Закрытая конфигурация", guideA);

    const visitorRead = await delivery.read({
      guideId: guideA,
      subject: { kind: "anonymous" },
    });
    expect(visitorRead.ok).toBe(true);
    if (!visitorRead.ok) throw new Error("visitor read failed");
    expect(
      visitorRead.value
        .filter(({ artifactId }) => artifactId === free || artifactId === paid)
        .map(({ artifactId, availability }) => [artifactId, availability]),
    ).toEqual([
      [free, "available"],
      [paid, "locked"],
    ]);

    const visitorBytes = await delivery.deliver({
      artifactId: free,
      guideId: guideA,
      preview: false,
      subject: { kind: "anonymous" },
      version: 1,
    });
    expect(visitorBytes).toMatchObject({
      ok: true,
      value: { cacheScope: "public-immutable", kind: "bytes" },
    });

    const visitorDenied = await delivery.deliver({
      artifactId: paid,
      guideId: guideA,
      preview: false,
      subject: { kind: "anonymous" },
      version: 1,
    });
    expect(visitorDenied).toEqual({
      error: { code: "artifact_not_found" },
      ok: false,
    });

    await grant([`guide:${guideA}`]);
    const memberSubject = {
      accountId: accountId(member),
      kind: "account" as const,
    };
    const memberDownload = await delivery.deliver({
      artifactId: paid,
      guideId: guideA,
      preview: false,
      subject: memberSubject,
      version: 1,
    });
    expect(memberDownload).toMatchObject({
      ok: true,
      value: { cacheScope: "private-no-store", kind: "redirect" },
    });

    // A member of one guide never reaches the same artifact through another
    // guide it was never placed in.
    expect(
      await delivery.deliver({
        artifactId: paid,
        guideId: guideB,
        preview: false,
        subject: memberSubject,
        version: 1,
      }),
    ).toEqual({ error: { code: "artifact_not_found" }, ok: false });

    // A stale version address stops working once the content is replaced.
    const replaced = await artifacts.replaceContent({
      actor: owner,
      artifactId: paid,
      externalUrl: "https://example.test/config",
      kind: "link",
    });
    expect(replaced).toMatchObject({ ok: true, value: { version: 2 } });
    expect(
      await delivery.deliver({
        artifactId: paid,
        guideId: guideA,
        preview: false,
        subject: memberSubject,
        version: 1,
      }),
    ).toEqual({ error: { code: "artifact_not_found" }, ok: false });

    // A locked link artifact keeps its description and hides the address.
    const visitorAfter = await delivery.read({
      guideId: guideA,
      subject: { kind: "anonymous" },
    });
    expect(visitorAfter.ok).toBe(true);
    if (!visitorAfter.ok) throw new Error("visitor read failed");
    expect(
      visitorAfter.value.find(({ artifactId }) => artifactId === paid),
    ).toMatchObject({
      availability: "locked",
      content: { externalUrl: null, kind: "link" },
      title: "Закрытая конфигурация",
    });
    expect(
      (
        await delivery.read({ guideId: guideA, subject: memberSubject })
      ).ok,
    ).toBe(true);
    const memberRead = await delivery.read({
      guideId: guideA,
      subject: memberSubject,
    });
    if (!memberRead.ok) throw new Error("member read failed");
    expect(
      memberRead.value.find(({ artifactId }) => artifactId === paid),
    ).toMatchObject({
      availability: "available",
      content: { externalUrl: "https://example.test/config", kind: "link" },
    });
  });

  test("archives an artifact and refuses to remove one a guide still references", async () => {
    const artifactId = await createArtifact("free", "Временный шаблон", guideB);
    const referenced = await artifacts.remove({ actor: owner, artifactId });
    expect(referenced).toEqual({
      error: { code: "artifact_referenced", guideIds: [guideB] },
      ok: false,
    });

    const archived = await artifacts.setArchived({
      actor: owner,
      archived: true,
      artifactId,
    });
    expect(archived).toMatchObject({ ok: true, value: { archived: true } });
    const reader = await delivery.read({
      guideId: guideB,
      subject: { kind: "anonymous" },
    });
    expect(
      reader.ok && reader.value.some((item) => item.artifactId === artifactId),
    ).toBe(false);
    expect(
      await delivery.deliver({
        artifactId,
        guideId: guideB,
        preview: false,
        subject: { kind: "anonymous" },
        version: 1,
      }),
    ).toEqual({ error: { code: "artifact_not_found" }, ok: false });

    // The author still sees an archived artifact and may return it.
    const authorList = await artifacts.listForGuide({
      actor: owner,
      guideId: guideB,
    });
    expect(
      authorList.ok && authorList.value.some((item) => item.artifactId === artifactId),
    ).toBe(true);

    await artifacts.setGuides({ actor: owner, artifactId, guideIds: [] });
    expect(await artifacts.remove({ actor: owner, artifactId })).toEqual({
      ok: true,
      value: { artifactId },
    });
  });

  test("keeps a Platform-authored artifact outside repeated authoring imports", async () => {
    const guideId = randomUUID();
    await db.prisma.guide.create({
      data: { id: guideId, name: "Import guide", slug: guideId },
    });
    const platformArtifact = await createArtifact(
      "free",
      "Заведён в редакторе",
      guideId,
    );
    const before = await db.prisma.guideArtifact.findUniqueOrThrow({
      where: { id: platformArtifact },
    });

    const first = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [
        {
          access: "free",
          externalUrl: "https://example.test/authored",
          purpose: "Из авторской базы",
          sourceId: "authored-one",
          title: "Авторский артефакт",
        },
      ],
      guideId,
    });
    expect(first).toMatchObject({
      ok: true,
      value: { outcomes: [{ outcome: "created", sourceId: "authored-one" }] },
    });

    const second = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [
        {
          access: "free",
          externalUrl: "https://example.test/authored",
          purpose: "Из авторской базы",
          sourceId: "authored-one",
          title: "Авторский артефакт",
        },
      ],
      guideId,
    });
    expect(second).toMatchObject({
      ok: true,
      value: { outcomes: [{ outcome: "unchanged", sourceId: "authored-one" }] },
    });

    // The editor-authored record is never matched, changed or archived, and it
    // never appears in an import report.
    const outcomes = second.ok ? second.value.outcomes : [];
    expect(
      outcomes.some(({ artifactId }) => artifactId === platformArtifact),
    ).toBe(false);
    const after = await db.prisma.guideArtifact.findUniqueOrThrow({
      where: { id: platformArtifact },
    });
    expect(after).toEqual(before);
  });

  test("reports a manually changed or absent authoring artifact instead of overwriting it", async () => {
    const guideId = randomUUID();
    await db.prisma.guide.create({
      data: { id: guideId, name: "Divergence guide", slug: guideId },
    });
    const source = {
      access: "free" as const,
      externalUrl: "https://example.test/one",
      purpose: "Первая версия",
      sourceId: "divergence-one",
      title: "Импортированный артефакт",
    };
    const created = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [source],
      guideId,
    });
    const artifactId = created.ok ? created.value.outcomes[0]?.artifactId : "";
    expect(artifactId).toBeTruthy();

    const edited = await artifacts.replaceContent({
      actor: owner,
      artifactId: artifactId ?? "",
      externalUrl: "https://example.test/edited-by-hand",
      kind: "link",
    });
    expect(edited).toMatchObject({ ok: true, value: { version: 2 } });

    const diverged = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [{ ...source, title: "Новое название из пакета" }],
      guideId,
    });
    expect(diverged).toMatchObject({
      ok: true,
      value: { outcomes: [{ artifactId, outcome: "diverged" }] },
    });
    const untouched = await db.prisma.guideArtifact.findUniqueOrThrow({
      where: { id: artifactId ?? "" },
    });
    expect(untouched.title).toBe("Импортированный артефакт");

    // An artifact absent from the package is reported, never archived.
    const missing = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [],
      guideId,
    });
    expect(missing).toMatchObject({
      ok: true,
      value: { outcomes: [{ artifactId, outcome: "missing" }] },
    });
    expect(
      (
        await db.prisma.guideArtifact.findUniqueOrThrow({
          where: { id: artifactId ?? "" },
        })
      ).state,
    ).toBe("active");
  });

  async function createArtifact(
    access: "free" | "membership",
    title: string,
    guideId: string,
  ): Promise<string> {
    const created = await artifacts.create({
      actor: owner,
      file: fileUpload(`${title}.md`, `# ${title}\n`),
      guideId,
      kind: "file",
      metadata: { access, purpose: "Проверка доступа", title },
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.artifactId;
  }

  async function grant(capabilities: AccessCapability[]): Promise<void> {
    const rowKey = "artifact-fixture";
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          accountId: member,
          rowKey,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities,
            reason: "Controlled #466 fixture",
            startsAt: new Date().toISOString(),
            validUntil: null,
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    const applied = await grants.applyBatch(owner, {
      confirmedRows: [rowKey],
      expectedRevision: preview.revision,
      operationId: randomUUID(),
      previewRef: preview.previewRef,
    });
    if (!applied.ok) throw new Error("grant fixture failed");
  }
});

function fileUpload(
  filename: string,
  content: string,
  declaredContentType = "text/markdown",
) {
  const body = new TextEncoder().encode(content);
  return {
    body,
    declaredContentType,
    declaredSize: body.byteLength,
    expectedChecksumSha256: sha256(body),
    filename,
  };
}

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function storageKey(namespace: ObjectStorageNamespace, key: string): string {
  return `${namespace}:${key}`;
}
