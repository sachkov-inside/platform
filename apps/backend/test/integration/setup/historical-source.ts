import {
  Prisma,
  type PlatformPrisma,
} from "../../../src/infrastructure/prisma/index.js";

/** A passive original from before 0113. Current feed readers must ignore this retired flag. */
export async function seedHistoricalFeedSource(
  prisma: PlatformPrisma,
  materialId: string,
) {
  const original = {
    id: `fixture:historical-feed-${materialId}`,
    path: `${materialId}.md`,
    revision: "a".repeat(64),
    commit: null,
    showInFeed: false,
  };
  await prisma.$executeRaw(Prisma.sql`
    insert into materials.historical_source_records(material_id, original)
    values (${materialId}::uuid, ${JSON.stringify(original)}::jsonb)
  `);
}
