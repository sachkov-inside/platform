import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  boundedSequence,
  propertySeeds,
} from "../support/bounded-sequences.js";
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
    let now = new Date("2030-01-31T10:00:00.000Z");
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
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
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
      projects: { public: "free", protected: "closed" },
      clock: () => now,
    });
    const content = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      assetResourceFacts: assembleAssetResourceFacts(assets),
      videoResourceFacts: assembleVideoResourceFacts(videos),
      productTaskResourceFacts: assembleProductTaskResourceFacts(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
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
        data: { productId: productId, materialId: id },
      });
      await db.prisma.publishedMaterialProductMembership.create({
        data: { productId: productId, materialId: id },
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
    const materialResource = own[0];
    if (materialResource?.kind !== "material")
      throw new Error("Material fixture missing");
    for (const seed of propertySeeds()) {
      const choices = boundedSequence(seed, [holder, stranger, "anonymous"], 6);
      for (const [index, who] of choices.entries()) {
        const subject =
          who === "anonymous"
            ? { kind: "anonymous" as const }
            : { kind: "account" as const, accountId: accountId(who) };
        const operations = [...own, ...foreign, materialResource].map(
          (resource, ordinal) => ({
            itemId: `seed-${seed}-${index}-${ordinal}`,
            resource,
            action:
              resource.kind === "video"
                ? ("play" as const)
                : resource.kind === "asset"
                  ? ("download" as const)
                  : ("read" as const),
          }),
        );
        const request = {
          subject,
          enforcementPoint: "published_material_read" as const,
          correlationId: `seed-${seed}`,
        };
        const batch = await content.checkAvailabilityMany({
          ...request,
          operations,
        });
        expect(batch.ok).toBe(true);
        if (!batch.ok) throw new Error(batch.error.code);
        expect(batch.items.map((item) => item.itemId)).toEqual(
          operations.map((item) => item.itemId),
        );
        for (const [ordinal, operation] of operations.entries()) {
          const scalar = await content.authorize({ ...request, ...operation });
          expect(
            batch.items[ordinal]?.availability === "available",
            `seed=${seed}; item=${operation.itemId}`,
          ).toBe(scalar.effect === "allow");
          if (who !== holder || (ordinal >= 4 && ordinal < 8))
            expect(scalar.effect).toBe("deny");
        }
        const reversed = await content.checkAvailabilityMany({
          ...request,
          operations: [...operations].reverse(),
        });
        expect(reversed.ok && [...reversed.items].reverse()).toEqual(
          batch.items,
        );
      }
    }
    for (const seed of propertySeeds()) {
      for (const selectedProduct of boundedSequence(
        seed,
        [product, otherProduct],
        2,
      )) {
        const candidate = randomUUID();
        await db.prisma.account.create({
          data: {
            id: candidate,
            logtoIssuer: "https://identity.test",
            logtoSubject: candidate,
          },
        });
        const temporary = await grants.issueProductAccess(
          { source: "manual", actorId: owner },
          {
            accountId: candidate,
            productId: selectedProduct,
            sourceRef: randomUUID(),
            issuedAt: now.toISOString(),
            reason: "Generated rights case",
          },
        );
        if (!temporary.ok) throw new Error(temporary.error.code);
        for (const [resources, owningProduct] of [
          [own, product],
          [foreign, otherProduct],
        ] as const) {
          for (const resource of resources) {
            expect(await authorize(candidate, resource)).toMatchObject({
              effect: selectedProduct === owningProduct ? "allow" : "deny",
            });
            expect(
              await content.authorize({
                subject: { kind: "account", accountId: accountId(candidate) },
                resource,
                action: resource.kind === "video" ? "download" : "play",
                enforcementPoint: "material_open",
                correlationId: `invalid-action-${seed}`,
              }),
            ).toMatchObject({
              effect: "deny",
              reason: "resource_action_invalid",
            });
          }
        }
        expect(
          await grants.revokeProductAccess(owner, {
            accountId: candidate,
            productId: selectedProduct,
            operationId: randomUUID(),
            expectedRevision: temporary.value.revision,
            reason: "End generated rights case",
          }),
        ).toMatchObject({ ok: true });
      }
    }
    const beforeCalendarBoundary = now;
    for (const instant of [
      "2030-12-31T23:59:59.999Z",
      "2031-01-01T00:00:00.000Z",
      "2100-01-01T00:00:00.000Z",
    ]) {
      now = new Date(instant);
      for (const resource of own)
        expect(await authorize(holder, resource)).toMatchObject({
          effect: "allow",
          validUntil: null,
          decidedAt: instant,
        });
    }
    now = beforeCalendarBoundary;
    for (const seed of propertySeeds()) {
      for (const [index, state] of boundedSequence(
        seed,
        ["draft", "published", "unpublished"] as const,
        6,
      ).entries()) {
        const version = index + 2;
        now = new Date(now.getTime() + 1);
        await db.prisma.$transaction(async (tx) => {
          await tx.material.update({
            where: { id: materialResource.materialId },
            data: {
              publicationState: state,
              contentVersion: BigInt(version),
              firstPublishedAt: state === "draft" ? null : now,
              publishedAt: state === "draft" ? null : now,
              publishedBy: state === "draft" ? null : owner,
            },
          });
          await tx.publishedMaterial.update({
            where: { materialId: materialResource.materialId },
            data: { contentVersion: BigInt(version) },
          });
        });
        for (const resource of own) {
          if (resource.kind === "productTask")
            await db.prisma.productTask.update({
              where: { id: resource.taskId },
              data: {
                publicationState:
                  state === "published" ? "published" : "unpublished",
              },
            });
          expect(await authorize(holder, resource)).toMatchObject({
            effect: state === "published" ? "allow" : "deny",
          });
        }
        const decision = await authorize(holder, materialResource);
        expect(decision).toMatchObject({
          effect: state === "published" ? "allow" : "deny",
          ...(state === "published" ? { checkedContentVersion: version } : {}),
          decidedAt: now.toISOString(),
        });
      }
    }
    for (const resource of own)
      if (resource.kind === "productTask")
        await db.prisma.productTask.update({
          where: { id: resource.taskId },
          data: { publicationState: "published" },
        });
    await db.prisma.$transaction(async (tx) => {
      await tx.material.update({
        where: { id: materialResource.materialId },
        data: {
          publicationState: "published",
          contentVersion: 1n,
          firstPublishedAt: now,
          publishedAt: now,
          publishedBy: owner,
        },
      });
      await tx.publishedMaterial.update({
        where: { materialId: materialResource.materialId },
        data: { contentVersion: 1n },
      });
    });
    await db.prisma.$executeRawUnsafe(
      'ALTER TABLE materials."materials" RENAME TO "materials_property_outage"',
    );
    try {
      expect(await authorize(holder, materialResource)).toMatchObject({
        effect: "deny",
        reason: "dependency_unavailable",
      });
      expect(
        await content.checkAvailabilityMany({
          subject: { kind: "account", accountId: accountId(holder) },
          operations: [
            { itemId: "outage", resource: materialResource, action: "read" },
          ],
          enforcementPoint: "material_open",
          correlationId: "real-db-outage",
        }),
      ).toEqual({
        ok: true,
        items: [{ itemId: "outage", availability: "unavailable" }],
      });
    } finally {
      await db.prisma.$executeRawUnsafe(
        'ALTER TABLE materials."materials_property_outage" RENAME TO "materials"',
      );
    }
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
        reason: "resource_not_found",
      });
  } finally {
    await db.dispose();
  }
});
