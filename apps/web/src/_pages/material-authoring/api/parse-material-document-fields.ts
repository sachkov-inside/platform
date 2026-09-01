import "server-only";

import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

import {
  materialDocumentSchema,
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

/** Parses the two JSON-encoded editor fields shared by draft creation and saving. */
export function parseMaterialDocumentFields(input: {
  readonly document: string;
  readonly seriesIds: string;
}): ParsedMaterialDocumentFields {
  let document: unknown;
  let seriesIds: unknown;
  try {
    document = JSON.parse(input.document) as unknown;
    seriesIds = JSON.parse(input.seriesIds) as unknown;
  } catch {
    return {
      issues: [
        {
          message: "Данные редактора повреждены. Обновите страницу.",
          path: "/document",
        },
      ],
      ok: false,
    };
  }

  const parsedDocument = materialDocumentSchema.safeParse(document);
  const parsedSeriesIds = seriesIdsSchema.safeParse(seriesIds);
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
