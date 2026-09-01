import "server-only";

import { z } from "zod";

import { requestContentCollectionCreation } from "@/shared/api/backend/index.server";
import type { CreateContentCollectionResult } from "../model/content-collections";
import { mapContentCollectionMutationResult } from "./content-collection-mutation-result";

const formSchema = z.object({
  kind: z.enum(["series", "topic"]),
  name: z.string(),
  slug: z.string(),
  summary: z.string(),
});

export async function executeCreateContentCollection(
  formData: FormData,
  accessToken: string,
  request: typeof requestContentCollectionCreation = requestContentCollectionCreation,
): Promise<CreateContentCollectionResult> {
  const input = formSchema.safeParse({
    kind: formData.get("kind"),
    name: formData.get("name"),
    slug: formData.get("slug"),
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
