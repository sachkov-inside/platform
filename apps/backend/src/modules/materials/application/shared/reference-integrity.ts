import type { MaterialMetadata } from "../../domain/material-metadata.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import { rollback } from "./application-result.js";

async function findReferenceIssues(
  transaction: AuthoringTransaction,
  metadata: MaterialMetadata,
): Promise<readonly { readonly code: string; readonly path: string }[]> {
  const issues: { code: string; path: string }[] = [];
  const topic = await transaction
    .selectFrom("topics")
    .select("id")
    .where("id", "=", metadata.topicId)
    .executeTakeFirst();
  if (topic === undefined) {
    issues.push({ code: "topic_not_found", path: "/metadata/topicId" });
  }
  const format = await transaction
    .selectFrom("formats")
    .select("id")
    .where("id", "=", metadata.formatId)
    .executeTakeFirst();
  if (format === undefined) {
    issues.push({ code: "format_not_found", path: "/metadata/formatId" });
  }
  if (metadata.tagIds.length > 0) {
    const tags = await transaction
      .selectFrom("tags")
      .select("id")
      .where("id", "in", metadata.tagIds)
      .execute();
    const found = new Set(tags.map(({ id }) => id));
    metadata.tagIds.forEach((tagId, index) => {
      if (!found.has(tagId)) {
        issues.push({ code: "tag_not_found", path: `/metadata/tagIds/${index}` });
      }
    });
  }
  if (metadata.seriesMemberships.length > 0) {
    const seriesIds = metadata.seriesMemberships.map(({ seriesId }) => seriesId);
    const series = await transaction
      .selectFrom("series")
      .select("id")
      .where("id", "in", seriesIds)
      .execute();
    const found = new Set(series.map(({ id }) => id));
    metadata.seriesMemberships.forEach(({ seriesId }, index) => {
      if (!found.has(seriesId)) {
        issues.push({
          code: "series_not_found",
          path: `/metadata/seriesMemberships/${index}/seriesId`,
        });
      }
    });
  }
  return issues.sort((left, right) => left.path.localeCompare(right.path));
}

async function findSeriesOrdinalConflict(
  transaction: AuthoringTransaction,
  materialId: string,
  metadata: MaterialMetadata,
): Promise<{ readonly seriesId: string; readonly ordinal: number } | undefined> {
  if (metadata.seriesMemberships.length === 0) {
    return undefined;
  }
  const seriesIds = metadata.seriesMemberships.map(({ seriesId }) => seriesId);
  await transaction
    .selectFrom("series")
    .select("id")
    .where("id", "in", seriesIds)
    .orderBy("id")
    .forUpdate()
    .execute();

  const occupied = await transaction
    .selectFrom("series_memberships")
    .select(["series_id", "ordinal"])
    .where("series_id", "in", seriesIds)
    .where(
      "ordinal",
      "in",
      metadata.seriesMemberships.map(({ ordinal }) => ordinal),
    )
    .where("material_id", "!=", materialId)
    .execute();
  const occupiedKeys = new Set(
    occupied.map(({ series_id, ordinal }) => `${series_id}:${ordinal}`),
  );
  return metadata.seriesMemberships.find(({ seriesId, ordinal }) =>
    occupiedKeys.has(`${seriesId}:${ordinal}`),
  );
}

export async function requireReferenceIntegrity(
  transaction: AuthoringTransaction,
  materialId: string,
  metadata: MaterialMetadata,
): Promise<void> {
  const issues = await findReferenceIssues(transaction, metadata);
  if (issues.length > 0) {
    rollback({ code: "invalid_reference", issues });
  }
  const conflict = await findSeriesOrdinalConflict(transaction, materialId, metadata);
  if (conflict !== undefined) {
    rollback({ code: "series_ordinal_conflict", ...conflict });
  }
}
