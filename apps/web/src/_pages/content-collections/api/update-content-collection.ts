import "server-only";

import type { z } from "zod";

import { requestContentCollectionUpdate } from "@/shared/api/backend/index.server";
import type {
  updateContentCollectionInputSchema,
  UpdateContentCollectionResult,
} from "../model/content-collections";
import { mapUpdateContentCollectionResult } from "./content-collection-mutation-result";

/** All four introduction fields travel together or the stored introduction stays untouched. */
export async function executeUpdateContentCollection(
  input: z.output<typeof updateContentCollectionInputSchema>,
  accessToken: string,
  request: typeof requestContentCollectionUpdate = requestContentCollectionUpdate,
): Promise<UpdateContentCollectionResult> {
  try {
    const { introduction, ...metadata } = input;
    return mapUpdateContentCollectionResult(
      await request(
        {
          ...metadata,
          ...(introduction === undefined ? {} : { introduction }),
        },
        accessToken,
      ),
    );
  } catch {
    return { kind: "error", reference: "collections-backend" };
  }
}
