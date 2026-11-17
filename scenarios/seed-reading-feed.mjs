// @ts-check
import { z } from "zod";
import { openReadingMaterials, navigationReadingTopic } from "./reading.mjs";
import { isolatedScenarioApi } from "./isolated-api.mjs";

const collection = z.object({ id: z.uuid() }).loose();
const receipt = z
  .object({ materialId: z.uuid(), contentVersion: z.number().int().positive() })
  .loose();

/**
 * Publish the shared open-feed variant through its real authoring interfaces.
 * Product Materials cannot enter the feed (ADR0043); the separate learning scenario owns its programme.
 * @param {{ api: string; databaseName: string; ownerToken: string }} input
 */
export async function seedReadingFeedScenario({
  api,
  databaseName,
  ownerToken,
}) {
  const request = isolatedScenarioApi({ api, databaseName, ownerToken });
  const topic = collection.parse(
    await request("POST", "/authoring/collections", {
      kind: "topic",
      name: navigationReadingTopic.name,
      slug: navigationReadingTopic.slug,
      summary: "",
    }),
  );
  for (const fact of openReadingMaterials) {
    const source = {
      version: 2,
      id: `synthetic-reading:${fact.slug}`,
      path: `reading/${fact.slug}.md`,
      revision: "b".repeat(64),
    };
    const reserved = receipt.parse(
      await request("POST", "/authoring/import/materials/reserve", { source }),
    );
    receipt.parse(
      await request("POST", "/authoring/import/materials/apply", {
        source,
        materialId: reserved.materialId,
        expectedContentVersion: reserved.contentVersion,
        publicationState: "published",
        primaryVideoId: null,
        notifyTelegram: false,
        inFeed: true,
        metadata: {
          title: fact.title,
          summary: fact.summary,
          access: fact.access,
          difficulty: "basic",
          outcomes: [],
          topicId: topic.id,
          formatId: fact.format,
          tagIds: [],
          productIds: [],
        },
        body: {
          schemaVersion: 1,
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: fact.summary }],
              },
            ],
          },
        },
      }),
    );
  }
}
