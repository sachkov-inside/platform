import "server-only";

import type { z } from "zod";

import { requestContentCollectionArchive } from "@/shared/api/backend/index.server";
import type {
  setContentCollectionArchiveInputSchema,
  SetContentCollectionArchiveResult,
} from "../model/content-collections";
import { mapSetContentCollectionArchiveResult } from "./content-collection-mutation-result";

export async function executeSetContentCollectionArchive(
  input: z.output<typeof setContentCollectionArchiveInputSchema>,
  accessToken: string,
  request: typeof requestContentCollectionArchive = requestContentCollectionArchive,
): Promise<SetContentCollectionArchiveResult> {
  try {
    return mapSetContentCollectionArchiveResult(
      await request(input, accessToken),
    );
  } catch {
    return { kind: "error", reference: "collections-backend" };
  }
}
