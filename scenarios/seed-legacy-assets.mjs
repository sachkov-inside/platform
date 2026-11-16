// @ts-check
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { isolatedScenarioApi } from "./isolated-api.mjs";
import { legacyAssetsScenario } from "./legacy-assets.mjs";

const currentMaterial = z
  .object({
    materialId: z.uuid(),
    contentVersion: z.number().int().positive(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    primaryVideoId: z.uuid().nullable(),
    inFeed: z.boolean(),
    metadata: z
      .object({
        slug: z.string().nullable(),
        productMemberships: z.array(z.object({ productId: z.uuid() })),
      })
      .loose(),
    body: z.object({
      schemaVersion: z.literal(1),
      doc: z
        .object({
          type: z.literal("doc"),
          content: z.array(z.record(z.string(), z.unknown())),
        })
        .loose(),
    }),
  })
  .loose();

/**
 * Repair only the known overview in the caller's freshly seeded isolated instance.
 * @param {{api: string; databaseName: string; ownerToken: string}} input
 */
export async function seedLegacyMaterialAssets(input) {
  const request = isolatedScenarioApi(input);
  const published = z
    .object({ projection: z.object({ materialId: z.uuid() }) })
    .loose()
    .parse(await request("GET", `/materials/${legacyAssetsScenario.slug}`));
  const materialId = published.projection.materialId;
  const current = currentMaterial.parse(
    await request("GET", `/authoring/materials/${materialId}`),
  );
  if (current.metadata.slug !== legacyAssetsScenario.slug)
    throw new Error("Isolated overview identity changed");
  const nodes = current.body.doc.content;
  const body = structuredClone(current.body);
  for (const fact of legacyAssetsScenario.assets) {
    const at = nodes.findIndex(
      (node) =>
        z.object({ nodeId: z.string() }).safeParse(node["attrs"]).data
          ?.nodeId === fact.nodeId,
    );
    const node = nodes[at];
    if (
      node === undefined ||
      node["type"] !== (fact.kind === "image" ? "assetImage" : "assetFile")
    )
      throw new Error(`Isolated overview asset marker missing: ${fact.key}`);
    const bytes = Buffer.from(fact.text, "utf8");
    const upload = new FormData();
    upload.set("kind", fact.kind);
    upload.set("declaredSize", String(bytes.length));
    upload.set(
      "checksumSha256",
      createHash("sha256").update(bytes).digest("hex"),
    );
    upload.set(
      "file",
      new Blob([bytes], { type: fact.contentType }),
      fact.filename,
    );
    const asset = z
      .object({ assetId: z.uuid(), state: z.literal("ready") })
      .parse(
        await request(
          "POST",
          `/authoring/materials/${materialId}/assets`,
          upload,
          undefined,
          `isolated-overview:${fact.key}`,
        ),
      );
    body.doc.content[at] = {
      ...node,
      attrs: {
        ...z.record(z.string(), z.unknown()).parse(node["attrs"]),
        assetId: asset.assetId,
      },
    };
  }
  if (isDeepStrictEqual(body, current.body)) return;
  const { slug: _slug, productMemberships, ...metadata } = current.metadata;
  await request("PUT", `/authoring/materials/${materialId}`, {
    expectedContentVersion: current.contentVersion,
    publicationState: current.publicationState,
    primaryVideoId: current.primaryVideoId,
    inFeed: current.inFeed,
    notifyTelegram: false,
    metadata: {
      ...metadata,
      productIds: productMemberships.map(({ productId }) => productId),
    },
    body,
  });
}
