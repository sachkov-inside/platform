import "server-only";

import { z } from "zod";

import {
  requestContentCollectionArchive,
  requestContentCollectionCreation,
  requestContentCollectionUpdate,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import {
  contentCollectionSchema,
  type ContentCollectionMutationResult,
} from "../model/content-collections";

const baseSchema = z.object({
  action: z.enum(["archive", "create", "update"]),
  kind: z.enum(["series", "topic"]),
});

export async function executeContentCollectionMutation(
  formData: FormData,
  accessToken: string,
  dependencies: ContentCollectionMutationDependencies = defaultDependencies,
): Promise<ContentCollectionMutationResult> {
  const base = baseSchema.safeParse({
    action: formData.get("action"),
    kind: formData.get("kind"),
  });
  if (!base.success) return { kind: "invalid" };

  let result: BackendTransportResult;
  try {
    if (base.data.action === "create") {
      const input = z
        .object({ name: z.string(), slug: z.string(), summary: z.string() })
        .safeParse({
          name: formData.get("name"),
          slug: formData.get("slug"),
          summary: formData.get("summary"),
        });
      if (!input.success) return { kind: "invalid" };
      result = await dependencies.create(
        { ...input.data, kind: base.data.kind },
        accessToken,
      );
    } else if (base.data.action === "update") {
      const input = z
        .object({
          collectionId: z.uuid(),
          expectedVersion: z.coerce.number().int().positive(),
          name: z.string(),
          summary: z.string(),
        })
        .safeParse({
          collectionId: formData.get("collectionId"),
          expectedVersion: formData.get("expectedVersion"),
          name: formData.get("name"),
          summary: formData.get("summary"),
        });
      if (!input.success) return { kind: "invalid" };
      result = await dependencies.update(
        { ...input.data, kind: base.data.kind },
        accessToken,
      );
    } else {
      const input = z
        .object({
          archived: z.enum(["true", "false"]).transform((value) => value === "true"),
          collectionId: z.uuid(),
          expectedVersion: z.coerce.number().int().positive(),
        })
        .safeParse({
          archived: formData.get("archived"),
          collectionId: formData.get("collectionId"),
          expectedVersion: formData.get("expectedVersion"),
        });
      if (!input.success) return { kind: "invalid" };
      result = await dependencies.archive(
        { ...input.data, kind: base.data.kind },
        accessToken,
      );
    }
  } catch {
    return { kind: "error", reference: "collections-backend" };
  }

  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.response.status === 409) {
      const code = z.looseObject({ code: z.string() }).safeParse(result.problem);
      return code.success && code.data.code === "content_collection_slug_conflict"
        ? { kind: "slug_conflict" }
        : { kind: "conflict" };
    }
    if (result.response.status === 422) return { kind: "invalid" };
    return { kind: "error", reference: "collections-save" };
  }
  const collection = contentCollectionSchema.safeParse(result.body);
  return collection.success
    ? { kind: "saved", collection: collection.data }
    : { kind: "error", reference: "collections-receipt" };
}

export interface ContentCollectionMutationDependencies {
  readonly archive: typeof requestContentCollectionArchive;
  readonly create: typeof requestContentCollectionCreation;
  readonly update: typeof requestContentCollectionUpdate;
}

const defaultDependencies: ContentCollectionMutationDependencies = {
  archive: requestContentCollectionArchive,
  create: requestContentCollectionCreation,
  update: requestContentCollectionUpdate,
};
