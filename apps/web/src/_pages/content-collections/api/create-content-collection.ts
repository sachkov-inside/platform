import "server-only";

import type { z } from "zod";

import { requestContentCollectionCreation } from "@/shared/api/backend/index.server";
import type {
  createContentCollectionInputSchema,
  CreateContentCollectionResult,
} from "../model/content-collections";
import { mapCreateContentCollectionResult } from "./content-collection-mutation-result";

export async function executeCreateContentCollection(
  input: z.output<typeof createContentCollectionInputSchema>,
  accessToken: string,
  request: typeof requestContentCollectionCreation = requestContentCollectionCreation,
): Promise<CreateContentCollectionResult> {
  try {
    return mapCreateContentCollectionResult(await request(input, accessToken));
  } catch {
    return { kind: "error", reference: "collections-backend" };
  }
}
