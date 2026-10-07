import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  loadGuideCompositions,
  guideCompositionChapters,
} from "../../shared/guide-composition.js";

// A report selector lists every Guide at once; the bound only stops a runaway catalog.
const MAX_GUIDES = 200;

const rowsSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    chapters: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        materialIds: z.array(z.uuid()),
      }),
    ),
  }),
);

export type GuideOutline = z.infer<typeof rowsSchema>[number];
export type GuideOutlinesResult =
  | { readonly ok: true; readonly value: readonly GuideOutline[] }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "guides_too_many" | "dependency_unavailable";
      };
    };

/**
 * Current Guides with their chapters in author order and the published, reader-visible
 * Materials of each chapter: the same composition the Guide programme shows.
 */
export class GuideOutlines {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  async list(): Promise<GuideOutlinesResult> {
    try {
      const guides = await loadGuideCompositions(
        this.prisma,
        { current: true },
        MAX_GUIDES + 1,
      );
      const rows = rowsSchema.parse(
        guides.map((guide) => ({
          id: guide.id,
          name: guide.name,
          chapters: guideCompositionChapters(guide).map(
            ({ id, name, materialIds }) => ({ id, name, materialIds }),
          ),
        })),
      );
      if (rows.length > MAX_GUIDES)
        return { ok: false, error: { code: "guides_too_many" } };
      return { ok: true, value: rows };
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "listGuideOutlines" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }
}
