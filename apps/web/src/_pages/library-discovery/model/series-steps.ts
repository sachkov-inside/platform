import type { MaterialPreview } from "@/entities/material";

export interface SeriesStep {
  readonly label: string;
  readonly ordinal: number;
  readonly total: number;
}

/** Receives the complete published composition, never a paginated catalog. */
export function seriesSteps(items: readonly MaterialPreview[], seriesSlug: string): ReadonlyMap<string, SeriesStep> {
  const labels = items.map((item) => item.seriesMemberships.find(({ slug }) => slug === seriesSlug)?.stepGroup ?? null);
  const totals = new Map<string, number>();
  for (const label of labels) if (label !== null) totals.set(label, (totals.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  const steps = new Map<string, SeriesStep>();
  items.forEach((item, index) => {
    const label = labels[index];
    if (label === null || label === undefined) return;
    const ordinal = (seen.get(label) ?? 0) + 1;
    seen.set(label, ordinal);
    steps.set(item.slug, { label, ordinal, total: totals.get(label) ?? 0 });
  });
  return steps;
}
