import { videoChaptersSchema } from "../../domain/video-chapters.js";
import { z } from "zod";
import { authoringSourceSchema } from "../../domain/authoring-source.js";
import {
  materialBodySnapshotWireSchema,
  materialMetadataSelectionWireSchema,
} from "../../adapters/material-authoring-wire.js";
import type {
  SaveMaterialResult,
  SaveMaterialError,
} from "../save-material/save-material.contract.js";
import type { Result } from "../../result.js";

export const reserveSourceBodySchema = z
  .object({ source: authoringSourceSchema })
  .strict();
export const applySourceBodySchema = z
  .object({
    source: authoringSourceSchema,
    materialId: z.uuid(),
    expectedContentVersion: z.number().int().positive(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    primaryVideoId: z.uuid().nullable(),
    videoChapters: videoChaptersSchema.optional(),
    metadata: materialMetadataSelectionWireSchema,
    body: materialBodySnapshotWireSchema,
  })
  .strict();

export type ReserveSourceCommand = z.infer<typeof reserveSourceBodySchema> & {
  readonly actor: string;
};
export type ApplySourceCommand = z.infer<typeof applySourceBodySchema> & {
  readonly actor: string;
  readonly idempotencyKey: string;
};
export type ReserveSourceOperation = (
  command: ReserveSourceCommand,
) => Promise<SaveMaterialResult>;
export type ApplySourceOperation = (
  command: ApplySourceCommand,
) => Promise<SaveMaterialResult>;

export const validateSourceBodySchema = applySourceBodySchema.omit({
  materialId: true,
  expectedContentVersion: true,
  primaryVideoId: true,
});
export type ValidateSourceOperation = (
  command: z.infer<typeof validateSourceBodySchema> & {
    readonly actor: string;
  },
) => Promise<Result<{ readonly valid: true }, SaveMaterialError>>;
