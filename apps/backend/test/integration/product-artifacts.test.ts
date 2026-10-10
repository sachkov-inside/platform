import { registerFixedClock } from "../support/fixed-clock.js";

import { createHash, randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import type {
  ObjectStorage,
  ObjectStorageNamespace,
} from "../../src/infrastructure/object-storage/index.js";
import {
  accountId,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  type ContentAccess,
} from "../../src/modules/content-access/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
  type AccessCapability,
} from "../../src/modules/account-rights/index.js";
import {
  assembleProductArtifactDelivery,
  assembleProductArtifactResourceFacts,
  assembleProductArtifacts,
  assembleMaterialResourceFacts,
  assembleMaterials,
  type ProductArtifactDelivery,
  type ProductArtifacts,
} from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const owner = randomUUID();
const member = randomUUID();
const productA = randomUUID();
const productB = randomUUID();
const topicId = randomUUID();

// Every artifact read and write uses production facets over real PostgreSQL and
// a controlled object storage double. No real purchase, publication or upload
// leaves this test database.
describe("Product Artifacts", () => {
  let db: TestDatabase;
  let artifacts: ProductArtifacts;
  let delivery: ProductArtifactDelivery;
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

  beforeEach(() => {
    writes.length = 0;
    deletes.length = 0;
    signed.length = 0;
  });

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
      data: {
        id: topicId,
        name: "Synthetic artifacts",
        slug: "artifact-topic",
      },
    });
    for (const id of [productA, productB]) {
      await db.prisma.product.create({
        data: { id, name: `Synthetic product ${id}`, slug: id },
      });
    }
    const accounts = assembleAccounts({
      emailFingerprintKey: "synthetic-product-artifact-fingerprint-key",
      prisma: db.prisma,
    });
    grants = assembleAccessGrants({ accounts, prisma: db.prisma });
    const accountRights = assembleAccountRights({
      prisma: db.prisma,
    });
    artifacts = assembleProductArtifacts({
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
      productArtifactResourceFacts:
        assembleProductArtifactResourceFacts(artifacts),
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountRights,
    });
    delivery = assembleProductArtifactDelivery({
      artifacts,
      contentAccess,
      objectStorage,
      signedGetTtlSeconds: 60,
    });
  });

  afterAll(async () => {
    await db.dispose();
  });

  test("keeps one artifact record while two products reuse it and a new file version replaces the old one", async () => {
    const created = await artifacts.create({
      actor: owner,
      file: fileUpload("checklist.md", "# Release checklist\n- one\n"),
      productId: productA,
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
        productIds: [productA],
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
    expect(deletes.filter(({ key }) => key.includes(artifactId))).toEqual([
      expect.objectContaining({ namespace: "quarantine" }),
    ]);

    const placed = await artifacts.setProducts({
      actor: owner,
      artifactId,
      productIds: [productA, productB],
    });
    expect(placed).toMatchObject({ ok: true });
    for (const productId of [productA, productB]) {
      const listed = await artifacts.listForProduct({
        actor: owner,
        productId,
      });
      expect(listed.ok && listed.value.map((item) => item.artifactId)).toEqual([
        artifactId,
      ]);
    }
    expect(await db.prisma.productArtifact.count()).toBe(1);

    const replaced = await artifacts.replaceContent({
      actor: owner,
      artifactId,
      file: fileUpload("checklist.md", "# Release checklist\n- one\n- two\n"),
      kind: "file",
    });
    expect(replaced).toMatchObject({
      ok: true,
      value: { artifactId, productIds: [productA, productB], version: 2 },
    });
    expect(
      await db.prisma.productArtifactVersion.count({ where: { artifactId } }),
    ).toBe(2);
    const previous = await db.prisma.productArtifactVersion.findUniqueOrThrow({
      where: { artifactId_version: { artifactId, version: 1 } },
    });
    expect(previous.supersededAt).not.toBeNull();
  });

  test("refuses an executable upload and creates no artifact", async () => {
    const before = await db.prisma.productArtifact.count();
    const rejected = await artifacts.create({
      actor: owner,
      file: fileUpload(
        "setup.sh",
        "#!/bin/sh\necho install\n",
        "text/x-shellscript",
      ),
      productId: productA,
      kind: "file",
      metadata: { access: "free", purpose: "", title: "Установщик" },
    });
    expect(rejected).toEqual({
      error: { code: "invalid_content", reason: "executable_content" },
      ok: false,
    });
    expect(await db.prisma.productArtifact.count()).toBe(before);
  });

  test("delivers a free artifact to a visitor and a membership artifact only to a granted account", async () => {
    const free = await createArtifact("free", "Публичный шаблон", productA);
    const paid = await createArtifact(
      "closed",
      "Закрытая конфигурация",
      productA,
    );

    const visitorRead = await delivery.read({
      productId: productA,
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
      productId: productA,
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
      productId: productA,
      preview: false,
      subject: { kind: "anonymous" },
      version: 1,
    });
    expect(visitorDenied).toEqual({
      error: { code: "artifact_not_found" },
      ok: false,
    });

    await grant([`product:${productA}`]);
    const memberSubject = {
      accountId: accountId(member),
      kind: "account" as const,
    };
    const memberDownload = await delivery.deliver({
      artifactId: paid,
      productId: productA,
      preview: false,
      subject: memberSubject,
      version: 1,
    });
    expect(memberDownload).toMatchObject({
      ok: true,
      value: { cacheScope: "private-no-store", kind: "redirect" },
    });

    // A member of one product never reaches the same artifact through another
    // product it was never placed in.
    expect(
      await delivery.deliver({
        artifactId: paid,
        productId: productB,
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
        productId: productA,
        preview: false,
        subject: memberSubject,
        version: 1,
      }),
    ).toEqual({ error: { code: "artifact_not_found" }, ok: false });

    // A locked link artifact keeps its description and hides the address.
    const visitorAfter = await delivery.read({
      productId: productA,
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
      (await delivery.read({ productId: productA, subject: memberSubject })).ok,
    ).toBe(true);
    const memberRead = await delivery.read({
      productId: productA,
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

  test("opens a new delivery version when the access class changes", async () => {
    const artifactId = await createArtifact("free", "Смена доступа", productB);
    const before = await delivery.deliver({
      artifactId,
      productId: productB,
      preview: false,
      subject: { kind: "anonymous" },
      version: 1,
    });
    expect(before).toMatchObject({ ok: true, value: { kind: "bytes" } });

    const restricted = await artifacts.update({
      actor: owner,
      artifactId,
      metadata: {
        access: "closed",
        purpose: "Проверка доступа",
        title: "Смена доступа",
      },
    });
    expect(restricted).toMatchObject({ ok: true, value: { version: 2 } });

    // The public address issued under the previous access class stops working.
    expect(
      await delivery.deliver({
        artifactId,
        productId: productB,
        preview: false,
        subject: { kind: "anonymous" },
        version: 1,
      }),
    ).toEqual({ error: { code: "artifact_not_found" }, ok: false });
    expect(
      await delivery.deliver({
        artifactId,
        productId: productB,
        preview: false,
        subject: { kind: "anonymous" },
        version: 2,
      }),
    ).toEqual({ error: { code: "artifact_not_found" }, ok: false });

    // The new version keeps the same stored content for an authorized reader.
    const current = await db.prisma.productArtifactVersion.findUniqueOrThrow({
      where: { artifactId_version: { artifactId, version: 2 } },
    });
    const previous = await db.prisma.productArtifactVersion.findUniqueOrThrow({
      where: { artifactId_version: { artifactId, version: 1 } },
    });
    expect(current.protectedObjectKey).toBe(previous.protectedObjectKey);
    expect(current.contentKind).toBe(previous.contentKind);

    await artifacts.setProducts({ actor: owner, artifactId, productIds: [] });
    await artifacts.remove({ actor: owner, artifactId });
  });

  test("archives an artifact and refuses to remove one a product still references", async () => {
    const artifactId = await createArtifact(
      "free",
      "Временный шаблон",
      productB,
    );
    const referenced = await artifacts.remove({ actor: owner, artifactId });
    expect(referenced).toEqual({
      error: { code: "artifact_referenced", productIds: [productB] },
      ok: false,
    });

    const archived = await artifacts.setArchived({
      actor: owner,
      archived: true,
      artifactId,
    });
    expect(archived).toMatchObject({ ok: true, value: { archived: true } });
    const reader = await delivery.read({
      productId: productB,
      subject: { kind: "anonymous" },
    });
    expect(
      reader.ok && reader.value.some((item) => item.artifactId === artifactId),
    ).toBe(false);
    expect(
      await delivery.deliver({
        artifactId,
        productId: productB,
        preview: false,
        subject: { kind: "anonymous" },
        version: 1,
      }),
    ).toEqual({ error: { code: "artifact_not_found" }, ok: false });

    // The author still sees an archived artifact and may return it.
    const authorList = await artifacts.listForProduct({
      actor: owner,
      productId: productB,
    });
    expect(
      authorList.ok &&
        authorList.value.some((item) => item.artifactId === artifactId),
    ).toBe(true);

    await artifacts.setProducts({ actor: owner, artifactId, productIds: [] });
    expect(await artifacts.remove({ actor: owner, artifactId })).toEqual({
      ok: true,
      value: { artifactId },
    });
  });

  test("keeps a Platform-authored artifact outside repeated authoring imports", async () => {
    const productId = randomUUID();
    await db.prisma.product.create({
      data: { id: productId, name: "Import product", slug: productId },
    });
    const platformArtifact = await createArtifact(
      "free",
      "Заведён в редакторе",
      productId,
    );
    const before = await db.prisma.productArtifact.findUniqueOrThrow({
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
      productId,
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
      productId,
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
    const after = await db.prisma.productArtifact.findUniqueOrThrow({
      where: { id: platformArtifact },
    });
    expect(after).toEqual(before);
  });

  test("reports a manually changed or absent authoring artifact instead of overwriting it", async () => {
    const productId = randomUUID();
    await db.prisma.product.create({
      data: { id: productId, name: "Divergence product", slug: productId },
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
      productId,
    });
    const artifactId = created.ok ? created.value.outcomes[0]?.artifactId : "";
    expect(artifactId).toBeTruthy();

    // Legacy manual changes can predate source ownership enforcement.
    expect(
      await artifacts.update({
        actor: owner,
        artifactId: artifactId ?? "",
        metadata: {
          access: "free",
          purpose: "Первая версия",
          title: "Новая правка",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await db.prisma.productArtifact.update({
      where: { id: artifactId ?? "" },
      data: {
        title: "Название, поправленное вручную",
        revision: { increment: 1 },
      },
    });

    const diverged = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [{ ...source, title: "Новое название из пакета" }],
      productId,
    });
    expect(diverged).toMatchObject({
      ok: true,
      value: { outcomes: [{ artifactId, outcome: "diverged" }] },
    });
    const untouched = await db.prisma.productArtifact.findUniqueOrThrow({
      where: { id: artifactId ?? "" },
    });
    expect(untouched.title).toBe("Название, поправленное вручную");

    // An archived legacy artifact is reported instead of being resurrected.
    const otherProduct = randomUUID();
    await db.prisma.product.create({
      data: { id: otherProduct, name: "Archive product", slug: otherProduct },
    });
    await db.prisma.productArtifact.update({
      where: { id: artifactId ?? "" },
      data: { state: "archived", archivedAt: new Date("2026-01-01T00:00:00Z") },
    });
    expect(
      await artifacts.applyAuthoringImport({
        actor: owner,
        artifacts: [source],
        productId: otherProduct,
      }),
    ).toMatchObject({
      ok: true,
      value: { outcomes: [{ artifactId, outcome: "diverged" }] },
    });
    expect(
      await db.prisma.productArtifactPlacement.count({
        where: { productId: otherProduct },
      }),
    ).toBe(0);
    await db.prisma.productArtifact.update({
      where: { id: artifactId ?? "" },
      data: { state: "active", archivedAt: null },
    });

    // An artifact absent from the package is reported, never archived.
    const missing = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [],
      productId,
    });
    expect(missing).toMatchObject({
      ok: true,
      value: { outcomes: [{ artifactId, outcome: "missing" }] },
    });
    expect(
      (
        await db.prisma.productArtifact.findUniqueOrThrow({
          where: { id: artifactId ?? "" },
        })
      ).state,
    ).toBe("active");
  });

  test("reuses an authoring artifact that already lives in another product", async () => {
    const first = randomUUID();
    const second = randomUUID();
    for (const id of [first, second]) {
      await db.prisma.product.create({
        data: { id, name: `Reuse product ${id}`, slug: id },
      });
    }
    const source = {
      access: "free" as const,
      externalUrl: "https://example.test/shared",
      purpose: "Общий шаблон",
      sourceId: "shared-template",
      title: "Общий шаблон",
    };
    const created = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [source],
      productId: first,
    });
    const artifactId = created.ok ? created.value.outcomes[0]?.artifactId : "";
    expect(created).toMatchObject({
      ok: true,
      value: { outcomes: [{ outcome: "created" }] },
    });

    const reused = await artifacts.applyAuthoringImport({
      actor: owner,
      artifacts: [source],
      productId: second,
    });
    expect(reused).toMatchObject({
      ok: true,
      value: { outcomes: [{ artifactId, outcome: "unchanged" }] },
    });
    expect(
      await db.prisma.productArtifact.count({
        where: { sourceId: source.sourceId },
      }),
    ).toBe(1);
    const placements = await db.prisma.productArtifactPlacement.findMany({
      where: { artifactId: artifactId ?? "" },
    });
    expect(placements.map(({ productId }) => productId).toSorted()).toEqual(
      [first, second].toSorted(),
    );
  });

  test("stores the Materials one artifact belongs with outside every Material body", async () => {
    const artifactId = await createArtifact(
      "free",
      "Связанный шаблон",
      productA,
    );
    const materialId = randomUUID();
    await db.prisma.material.create({
      data: {
        access: "free",
        body: {},
        contentVersion: 1,
        createdBy: owner,
        id: materialId,
        publicationState: "draft",
        schemaVersion: 1,
        slug: `material-${materialId}`,
        title: "Материал для артефакта",
        topicId,
      },
    });

    expect(
      await artifacts.setMaterials({
        actor: owner,
        artifactId,
        materialIds: [materialId, randomUUID()],
      }),
    ).toEqual({ error: { code: "material_not_found" }, ok: false });

    const linked = await artifacts.setMaterials({
      actor: owner,
      artifactId,
      materialIds: [materialId],
    });
    expect(linked).toMatchObject({
      ok: true,
      value: { materialIds: [materialId] },
    });
    const material = await db.prisma.material.findUniqueOrThrow({
      where: { id: materialId },
    });
    expect(material.body).toEqual({});
    expect(material.contentVersion).toBe(1n);

    // A linked artifact is not removed silently either.
    expect(await artifacts.remove({ actor: owner, artifactId })).toMatchObject({
      error: { code: "artifact_referenced" },
      ok: false,
    });
    await artifacts.setMaterials({ actor: owner, artifactId, materialIds: [] });
    await artifacts.setProducts({ actor: owner, artifactId, productIds: [] });
    expect(await artifacts.remove({ actor: owner, artifactId })).toEqual({
      ok: true,
      value: { artifactId },
    });
  });

  test("offers every active artifact for reuse only to a manager and reads its facts by id", async () => {
    const productId = randomUUID();
    await db.prisma.product.create({
      data: {
        id: productId,
        name: `Synthetic reuse product ${productId}`,
        slug: productId,
      },
    });
    const active = await createArtifact(
      "closed",
      "Шаблон для повтора",
      productId,
    );
    const archived = await createArtifact("free", "Снятый шаблон", productId);
    await artifacts.setArchived({
      actor: owner,
      archived: true,
      artifactId: archived,
    });

    const reusable = await artifacts.listReusable({ actor: owner });
    const offered = reusable.ok
      ? reusable.value.map(({ artifactId }) => artifactId)
      : [];
    expect(offered).toContain(active);
    expect(offered).not.toContain(archived);
    expect(await artifacts.listReusable({ actor: member })).toEqual({
      error: { code: "forbidden" },
      ok: false,
    });

    expect(await artifacts.loadAccessFacts([active, "not-a-uuid"])).toEqual([
      {
        access: "closed",
        archived: false,
        artifactId: active,
        productIds: [productId],
        version: 1,
      },
    ]);
    expect(
      await artifacts.loadFileDelivery({ artifactId: active, productId }),
    ).toMatchObject({
      ok: true,
      value: { artifactId: active, filename: "Шаблон для повтора.md" },
    });
    // A Product that does not place the artifact never serves its file.
    expect(
      await artifacts.loadFileDelivery({
        artifactId: active,
        productId: productA,
      }),
    ).toEqual({
      ok: true,
      value: null,
    });
  });

  async function createArtifact(
    access: "free" | "closed",
    title: string,
    productId: string,
  ): Promise<string> {
    const created = await artifacts.create({
      actor: owner,
      file: fileUpload(`${title}.md`, `# ${title}\n`),
      productId,
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
            // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
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
