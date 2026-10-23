import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  assembleAccounts,
  accountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  type Resource,
} from "../../src/modules/content-access/index.js";
import {
  assembleMaterialResourceFacts,
  assembleAssetResourceFacts,
  assembleVideoResourceFacts,
  materialId,
} from "../../src/modules/materials/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

test("ContentAccess uses the same PostgreSQL Product Access for current and future Material, Asset, Video and Task, including archival and withdrawal", async () => {
  const db = await createMigratedTestDatabase();
  try {
    const owner = randomUUID(),
      holder = randomUUID(),
      stranger = randomUUID(),
      product = randomUUID(),
      otherProduct = randomUUID(),
      topic = randomUUID();
    const now = new Date("2030-01-31T10:00:00.000Z");
    for (const id of [owner, holder, stranger])
      await db.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
      });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    await db.prisma.topic.create({
      data: { id: topic, name: "Rights", slug: topic },
    });
    for (const id of [product, otherProduct])
      await db.prisma.product.create({
        data: { id, name: "Product", slug: id },
      });
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-lifetime-content-access-key",
    });
    const grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => now,
    });
    const rights = assembleAccountRights({
      prisma: db.prisma,
      clock: () => now,
    });
    const issued = await grants.issueProductAccess(
      { source: "manual", actorId: owner },
      {
        accountId: holder,
        productId: product,
        sourceRef: randomUUID(),
        issuedAt: now.toISOString(),
        reason: "Lifetime issuance",
      },
    );
    expect(issued).toMatchObject({ ok: true, outcome: "issued" });
    const materials = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: (id) => id === owner },
    });
    const external = () =>
      Promise.reject(new Error("Provider I/O is not part of authorization"));
    const assets = assembleMaterialAssets({
      prisma: db.prisma,
      objectStorage: {
        putImmutable: external,
        read: external,
        delete: external,
        signGet: external,
      },
    });
    const videos = assembleVideos({
      prisma: db.prisma,
      canManage: () => Promise.resolve(false),
      provider: { delete: external, initUpload: external, find: external },
      projects: { free: "free", closed: "closed" },
      clock: () => now,
    });
    const content = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      assetResourceFacts: assembleAssetResourceFacts(assets),
      videoResourceFacts: assembleVideoResourceFacts(videos),
      productTaskResourceFacts: assembleProductTaskResourceFacts(db.prisma),
      accountPermissions: assembleCurrentAccountPermissions(accounts),
      accountRights: rights,
      clock: () => now,
    });
    async function publish(productId: string) {
      const id = randomUUID(),
        asset = randomUUID(),
        video = randomUUID(),
        task = randomUUID(),
        chapter = randomUUID();
      await db.prisma.material.create({
        data: {
          id,
          slug: id,
          title: "Closed lesson",
          summary: "Lesson",
          topicId: topic,
          formatId: "video",
          schemaVersion: 1,
          body: { type: "doc", content: [] },
          createdBy: owner,
          access: "closed",
          publicationState: "published",
          contentVersion: 1n,
          firstPublishedAt: now,
          publishedAt: now,
          publishedBy: owner,
        },
      });
      await db.prisma.video.create({
        data: {
          id: video,
          materialId: id,
          createdBy: owner,
          access: "closed",
          projectId: "closed",
          providerVideoId: video,
          title: "Lesson",
          origin: "platform_upload",
          providerStatus: "done",
          providerEmbedLocator: "https://video.test/lesson",
          readyAt: now,
          state: "ready",
        },
      });
      await db.prisma.material.update({
        where: { id },
        data: { primaryVideoId: video },
      });
      await db.prisma.publishedMaterial.create({
        data: {
          materialId: id,
          contentVersion: 1n,
          slug: id,
          title: "Closed lesson",
          summary: "Lesson",
          access: "closed",
          topicId: topic,
          formatId: "video",
          publicSearchText: "lesson",
          publishedBy: owner,
          publishedAt: now,
          primaryVideoId: video,
        },
      });
      await db.prisma.productMembership.create({
        data: { seriesId: productId, materialId: id },
      });
      await db.prisma.publishedMaterialProductMembership.create({
        data: { seriesId: productId, materialId: id },
      });
      await db.prisma.materialAsset.create({
        data: {
          id: asset,
          materialId: id,
          uploadedBy: owner,
          kind: "file",
          state: "ready",
          idempotencyKey: asset,
          requestFingerprint: "a".repeat(64),
          originalFilename: "lesson.pdf",
          declaredContentType: "application/pdf",
          declaredSize: 1,
          actualContentType: "application/pdf",
          actualSize: 1,
          actualChecksum: "b".repeat(64),
          readyAt: now,
          expectedChecksum: "b".repeat(64),
          objectNonce: randomUUID(),
          quarantineObjectKey: `${asset}/quarantine`,
          protectedObjectKey: `${asset}/protected`,
        },
      });
      await db.prisma.productChapter.create({
        data: { id: chapter, productId, ordinal: 1, name: "Chapter" },
      });
      await db.prisma.productTask.create({
        data: {
          id: task,
          code: task,
          sourceId: `inside-content:${task}`,
          productId,
          chapterId: chapter,
          position: 1,
          title: "Task",
          access: "closed",
          relatedMaterialSourceIds: [],
          publicationState: "published",
          currentVersion: 1,
          versions: {
            create: {
              version: 1,
              definition: {},
              definitionDigest: "c".repeat(64),
              createdAt: now,
              sourceRepository: "synthetic",
              sourceCommit: "d".repeat(40),
              sourcePath: "tasks/synthetic.md",
            },
          },
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
      return [
        { kind: "material", materialId: materialId(id) },
        { kind: "asset", assetId: asset },
        { kind: "video", videoId: video },
        { kind: "productTask", taskId: task },
      ] satisfies Resource[];
    }
    const own = await publish(product),
      foreign = await publish(otherProduct);
    async function authorize(who: string, resource: Resource) {
      return content.authorize({
        subject: { kind: "account", accountId: accountId(who) },
        resource,
        action:
          resource.kind === "video"
            ? "play"
            : resource.kind === "asset"
              ? "download"
              : "read",
        enforcementPoint:
          resource.kind === "video"
            ? "playback_token_issue"
            : resource.kind === "asset"
              ? "asset_delivery"
              : resource.kind === "productTask"
                ? "product_task_read"
                : "material_open",
        correlationId: randomUUID(),
      });
    }
    for (const resource of own) {
      expect(await authorize(holder, resource)).toMatchObject({
        effect: "allow",
        reason: "active_membership",
        validUntil: null,
      });
      expect(await authorize(stranger, resource)).toMatchObject({
        effect: "deny",
        reason: "membership_required",
      });
    }
    for (const resource of foreign)
      expect(await authorize(holder, resource)).toMatchObject({
        effect: "deny",
        reason: "membership_required",
      });
    await db.prisma.product.update({
      where: { id: product },
      data: { archivedAt: now },
    });
    for (const resource of own)
      expect(await authorize(holder, resource)).toMatchObject({
        effect: "allow",
      });
    if (!issued.ok) throw new Error(issued.error.code);
    expect(
      await grants.revokeProductAccess(owner, {
        accountId: holder,
        productId: product,
        operationId: randomUUID(),
        expectedRevision: issued.value.revision,
        reason: "Explicit withdrawal",
      }),
    ).toMatchObject({ ok: true });
    for (const resource of own)
      expect(await authorize(holder, resource)).toMatchObject({
        effect: "deny",
        reason:
          resource.kind === "productTask"
            ? "membership_required"
            : "resource_not_found",
      });
  } finally {
    await db.dispose();
  }
});
