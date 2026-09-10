import "server-only";

import { z } from "zod";

import { requestContentCollectionUpdate } from "@/shared/api/backend/index.server";
import {
  guideIntroductionSchema,
  type UpdateContentCollectionResult,
} from "../model/content-collections";
import { mapUpdateContentCollectionResult } from "./content-collection-mutation-result";

const formSchema = z.object({
  collectionId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  introduction: guideIntroductionSchema.optional(),
  kind: z.enum(["series", "topic"]),
  name: z.string(),
  summary: z.string(),
});

/** All four fields travel together or the stored introduction stays untouched. */
function readIntroduction(formData: FormData): unknown {
  const fields = ["audience", "outcome", "prerequisites", "scope"] as const;
  const values = fields.map((field) => formData.get(field));
  return values.every((value) => value === null)
    ? undefined
    : Object.fromEntries(fields.map((field, index) => [field, values[index]]));
}

export async function executeUpdateContentCollection(
  formData: FormData,
  accessToken: string,
  request: typeof requestContentCollectionUpdate = requestContentCollectionUpdate,
): Promise<UpdateContentCollectionResult> {
  const input = formSchema.safeParse({
    collectionId: formData.get("collectionId"),
    expectedVersion: formData.get("expectedVersion"),
    introduction: readIntroduction(formData),
    kind: formData.get("kind"),
    name: formData.get("name"),
    summary: formData.get("summary"),
  });
  if (!input.success) return { kind: "invalid" };
  try {
    const { introduction, ...metadata } = input.data;
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
