import { z } from "zod";
import { authoringSourceIdSchema } from "../../domain/authoring-source.js";
import { contentCollectionInputSchema } from "../create-content-collection/create-content-collection.js";
import { updateContentCollectionCommandSchema } from "../update-content-collection/update-content-collection.js";
import { reorderSeriesCommandSchema } from "../reorder-series/reorder-series.js";
import type { Result } from "../../result.js";
import type {
  ForbiddenError,
  InvalidContentError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { CreateContentCollectionResult } from "../create-content-collection/create-content-collection.contract.js";
import type { UpdateContentCollectionResult } from "../update-content-collection/update-content-collection.contract.js";
import type { ReorderSeriesResult } from "../reorder-series/reorder-series.contract.js";

const sourceId = authoringSourceIdSchema;
export const reserveSourceGuideBodySchema = contentCollectionInputSchema.omit({ actor: true, kind: true }).extend({ sourceId });
// Адрес, оформление и страница приходят вместе с названием: пакет описывает Guide целиком (ADR 0026).
export const updateSourceGuideBodySchema = z.object(updateContentCollectionCommandSchema.shape).omit({ actor: true, kind: true, introduction: true, source: true }).extend({ sourceId, source: updateContentCollectionCommandSchema.shape.source.unwrap() });
export const reorderSourceGuideBodySchema = z.object(reorderSeriesCommandSchema.shape).omit({ actor: true }).extend({ sourceId });
// Описание проверяется до первой записи переноса: пакет с непроходимым описанием отклоняется целиком.
export const validateSourceGuideBodySchema = z.object({ sourceId, source: updateContentCollectionCommandSchema.shape.source.unwrap() }).strict();
export type ValidateSourceGuideOperation = (command: z.input<typeof validateSourceGuideBodySchema> & { readonly actor: string }) => Promise<Result<{ readonly valid: true }, ForbiddenError | InvalidContentError | SystemError>>;

export type ReserveSourceGuideOperation = (command: z.infer<typeof reserveSourceGuideBodySchema> & { readonly actor: string }) => Promise<CreateContentCollectionResult>;
export type UpdateSourceGuideOperation = (command: z.infer<typeof updateSourceGuideBodySchema> & { readonly actor: string }) => Promise<UpdateContentCollectionResult>;
export type ReorderSourceGuideOperation = (command: z.input<typeof reorderSourceGuideBodySchema> & { readonly actor: string }) => Promise<ReorderSeriesResult>;
