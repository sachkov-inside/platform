import type {
  Prisma,
  MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import type { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

function toDatabaseJson(value: unknown): Exclude<Prisma.InputJsonValue, null> {
  const converted = convertJsonValue(value);
  if (converted === null) {
    throw new TypeError("Document root cannot be null");
  }
  return converted;
}

function convertJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(convertJsonValue);
  }
  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        result[key] = convertJsonValue(child);
      }
    }
    return result;
  }
  throw new TypeError("Document contains a non-JSON value");
}

export async function insertRevision(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly materialId: string;
    readonly restoredFromRevisionId?: string;
    readonly revisionId: string;
    readonly metadata: MaterialRevisionMetadata;
    readonly schemaVersion: number;
    readonly body: unknown;
  },
): Promise<void> {
  await transaction.materialRevision.create({
    data: {
      id: values.revisionId,
      materialId: values.materialId,
      restoredFromRevisionId: values.restoredFromRevisionId ?? null,
      title: values.metadata.title,
      summary: values.metadata.summary,
      slug: values.metadata.slug,
      access: values.metadata.access,
      topicId: values.metadata.topicId,
      formatId: values.metadata.formatId,
      schemaVersion: values.schemaVersion,
      body: toDatabaseJson(values.body),
      createdBy: values.actor,
    },
  });

  if (values.metadata.tagIds.length > 0) {
    await transaction.materialRevisionTag.createMany({
      data: values.metadata.tagIds.map((tagId) => ({
        materialId: values.materialId,
        revisionId: values.revisionId,
        tagId,
      })),
    });
  }
  if (values.metadata.seriesMemberships.length > 0) {
    await transaction.materialRevisionSeriesMembership.createMany({
      data: values.metadata.seriesMemberships.map(({ seriesId, ordinal }) => ({
        materialId: values.materialId,
        revisionId: values.revisionId,
        seriesId,
        ordinal,
      })),
    });
  }
}

export async function replaceCurrentRelations(
  transaction: MaterialsPrismaTransaction,
  materialId: string,
  metadata: MaterialRevisionMetadata,
): Promise<void> {
  await transaction.materialTag.deleteMany({ where: { materialId } });
  await transaction.seriesMembership.deleteMany({ where: { materialId } });

  if (metadata.tagIds.length > 0) {
    await transaction.materialTag.createMany({
      data: metadata.tagIds.map((tagId) => ({ materialId, tagId })),
    });
  }
  if (metadata.seriesMemberships.length > 0) {
    await transaction.seriesMembership.createMany({
      data: metadata.seriesMemberships.map(({ seriesId, ordinal }) => ({
        materialId,
        seriesId,
        ordinal,
      })),
    });
  }
}
