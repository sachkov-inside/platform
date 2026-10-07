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
export const reserveSourceProductBodySchema = contentCollectionInputSchema
  .omit({ actor: true, kind: true })
  .extend({ sourceId });
// Адрес, оформление и страница приходят вместе с названием: пакет описывает Product целиком (ADR 0026).
export const updateSourceProductBodySchema = z
  .object(updateContentCollectionCommandSchema.shape)
  .omit({ actor: true, kind: true, introduction: true, source: true })
  .extend({
    sourceId,
    source: updateContentCollectionCommandSchema.shape.source.unwrap(),
  });
export const reorderSourceProductBodySchema = z
  .object(reorderSeriesCommandSchema.shape)
  .omit({ actor: true })
  .extend({ sourceId });
// Описание проверяется до первой записи переноса: пакет с непроходимым описанием отклоняется целиком.
// `sourceId` называет продукт, чьё описание проверяется: маршрут остаётся source-scoped, как соседи.
export const validateSourceProductBodySchema = z
  .object({
    sourceId,
    source: updateContentCollectionCommandSchema.shape.source
      .unwrap()
      .partial({ slug: true }),
  })
  .strict();
export type ValidateSourceProductOperation = (
  command: z.input<typeof validateSourceProductBodySchema> & {
    readonly actor: string;
  },
) => Promise<
  Result<
    { readonly valid: true },
    ForbiddenError | InvalidContentError | SystemError
  >
>;

export type ReserveSourceProductOperation = (
  command: z.infer<typeof reserveSourceProductBodySchema> & {
    readonly actor: string;
  },
) => Promise<CreateContentCollectionResult>;

export type UpdateSourceProductOperation = (
  command: z.infer<typeof updateSourceProductBodySchema> & {
    readonly actor: string;
  },
) => Promise<UpdateContentCollectionResult>;
export type ReorderSourceProductOperation = (
  command: z.input<typeof reorderSourceProductBodySchema> & {
    readonly actor: string;
  },
) => Promise<ReorderSeriesResult>;
