import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { materialFormatSchema } from "@/shared/api/material-format";
import { z } from "zod";

import type { AuthoringMaterialFilterOptions } from "../model/authoring-materials-presentation";

export const authoringMaterialFiltersPath =
  "/api/authoring/materials/references";

const optionSchema = z
  .object({ label: z.string().min(1), value: z.uuid() })
  .strict();
const readySchema = z
  .object({
    formats: z.array(
      z
        .object({ label: z.string().min(1), value: materialFormatSchema })
        .strict(),
    ),
    kind: z.literal("ready"),
    topics: z.array(optionSchema),
  })
  .strict();

/** The filter choices; any failure leaves the filters with the values already in the address. */
export async function requestAuthoringMaterialFilters(
  signal: AbortSignal,
): Promise<AuthoringMaterialFilterOptions> {
  const result = await requestAuthenticatedRead(
    authoringMaterialFiltersPath,
    signal,
  );
  if (result.kind !== "ready") return { kind: "unavailable" };
  const parsed = readySchema.safeParse(result.value);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
