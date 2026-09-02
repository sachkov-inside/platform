import "server-only";

import { z } from "zod";

import { requestContentCollectionArchive } from "@/shared/api/backend/index.server";
import type { SetContentCollectionArchiveResult } from "../model/content-collections";
import { mapSetContentCollectionArchiveResult } from "./content-collection-mutation-result";

const formSchema = z.object({
  archived: z.enum(["true", "false"]).transform((value) => value === "true"),
  collectionId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  kind: z.enum(["series", "topic"]),
});

export async function executeSetContentCollectionArchive(
  formData: FormData,
  accessToken: string,
  request: typeof requestContentCollectionArchive = requestContentCollectionArchive,
): Promise<SetContentCollectionArchiveResult> {
  const input = formSchema.safeParse({
    archived: formData.get("archived"),
    collectionId: formData.get("collectionId"),
    expectedVersion: formData.get("expectedVersion"),
    kind: formData.get("kind"),
  });
  if (!input.success) return { kind: "invalid" };
  try {
    return mapSetContentCollectionArchiveResult(
      await request(input.data, accessToken),
    );
  } catch {
    return { kind: "error", reference: "collections-backend" };
  }
}
