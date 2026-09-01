import "server-only";

import { z } from "zod";

import { requestContentCollectionUpdate } from "@/shared/api/backend/index.server";
import type { UpdateContentCollectionResult } from "../model/content-collections";
import { mapContentCollectionMutationResult } from "./content-collection-mutation-result";

const formSchema = z.object({
  collectionId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  kind: z.enum(["series", "topic"]),
  name: z.string(),
  summary: z.string(),
});

export async function executeUpdateContentCollection(
  formData: FormData,
  accessToken: string,
  request: typeof requestContentCollectionUpdate = requestContentCollectionUpdate,
): Promise<UpdateContentCollectionResult> {
  const input = formSchema.safeParse({
    collectionId: formData.get("collectionId"),
    expectedVersion: formData.get("expectedVersion"),
    kind: formData.get("kind"),
    name: formData.get("name"),
    summary: formData.get("summary"),
  });
  if (!input.success) return { kind: "invalid" };
  try {
    return mapContentCollectionMutationResult(
      await request(input.data, accessToken),
    );
  } catch {
    return { kind: "error", reference: "collections-backend" };
  }
}
