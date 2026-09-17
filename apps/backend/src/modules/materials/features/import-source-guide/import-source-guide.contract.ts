import { z } from "zod";
import { contentCollectionInputSchema } from "../create-content-collection/create-content-collection.js";
import { updateContentCollectionCommandSchema } from "../update-content-collection/update-content-collection.js";
import { reorderSeriesCommandSchema } from "../reorder-series/reorder-series.js";
import type { CreateContentCollectionResult } from "../create-content-collection/create-content-collection.contract.js";
import type { UpdateContentCollectionResult } from "../update-content-collection/update-content-collection.contract.js";
import type { SetContentCollectionArchiveResult } from "../set-content-collection-archive/set-content-collection-archive.contract.js";
import type { ReorderSeriesResult } from "../reorder-series/reorder-series.contract.js";

const sourceId = z.string().trim().min(1).max(200);
export const reserveSourceGuideBodySchema = contentCollectionInputSchema.omit({ actor: true, kind: true }).extend({ sourceId });
export const updateSourceGuideBodySchema = z.object(updateContentCollectionCommandSchema.shape).omit({ actor: true, kind: true, introduction: true }).extend({ sourceId });
export const archiveSourceGuideBodySchema = z.object({ sourceId, collectionId: z.uuid(), expectedVersion: z.number().int().positive(), archived: z.boolean() }).strict();
export const reorderSourceGuideBodySchema = z.object(reorderSeriesCommandSchema.shape).omit({ actor: true }).extend({ sourceId });
export type ReserveSourceGuideOperation = (command: z.infer<typeof reserveSourceGuideBodySchema> & { readonly actor: string }) => Promise<CreateContentCollectionResult>;
export type UpdateSourceGuideOperation = (command: z.infer<typeof updateSourceGuideBodySchema> & { readonly actor: string }) => Promise<UpdateContentCollectionResult>;
export type ArchiveSourceGuideOperation = (command: z.infer<typeof archiveSourceGuideBodySchema> & { readonly actor: string }) => Promise<SetContentCollectionArchiveResult>;
export type ReorderSourceGuideOperation = (command: z.input<typeof reorderSourceGuideBodySchema> & { readonly actor: string }) => Promise<ReorderSeriesResult>;
