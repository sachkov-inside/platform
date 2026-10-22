import "server-only";

import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

import {
  materialDocumentContentSchema,
  type MaterialValidationIssue,
} from "@/widgets/material-authoring/model";

type ParsedMaterialDocumentFields =
  | {
      readonly document: JSONContent;
      readonly ok: true;
      readonly seriesIds: readonly string[];
    }
  | {
      readonly issues: readonly MaterialValidationIssue[];
      readonly ok: false;
    };

const seriesIdsSchema = z.array(z.uuid()).max(100);

/** Checks the structure of the two editor fields shared by draft creation and saving. */
export function parseMaterialDocumentFields(input: {
  readonly document: unknown;
  readonly seriesIds: unknown;
}): ParsedMaterialDocumentFields {
  const parsedDocument = materialDocumentContentSchema.safeParse(
    input.document,
  );
  const parsedSeriesIds = seriesIdsSchema.safeParse(input.seriesIds);
  if (!parsedDocument.success || !parsedSeriesIds.success) {
    return {
      issues: [
        {
          message: "Данные редактора имеют неверную структуру.",
          path: "/document",
        },
      ],
      ok: false,
    };
  }

  return {
    document: parsedDocument.data,
    ok: true,
    seriesIds: parsedSeriesIds.data,
  };
}
