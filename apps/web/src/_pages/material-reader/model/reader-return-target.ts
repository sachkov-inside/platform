import {
  homeMaterialReaderReturnTarget,
  parseMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import type { MaterialReaderMetadata } from "./material-reader-view";

/** Course return and primary-chapter navigation are independent. */
export function resolveReaderReturnTarget({
  returnTarget,
  material,
  hasSeriesContext = false,
  inferCourseReturn = false,
}: {
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly material?: Pick<MaterialReaderMetadata, "seriesMemberships">;
  readonly hasSeriesContext?: boolean;
  readonly inferCourseReturn?: boolean;
}): MaterialReaderReturnTarget {
  const memberships = material?.seriesMemberships ?? [];
  if (returnTarget.kind === "series") {
    return hasSeriesContext ||
      memberships.some(({ series }) => series.slug === returnTarget.seriesSlug)
      ? returnTarget
      : homeMaterialReaderReturnTarget;
  }
  const soleMembership = memberships.length === 1 ? memberships[0] : undefined;
  if (
    inferCourseReturn &&
    returnTarget.kind === "home" &&
    soleMembership !== undefined
  ) {
    return parseMaterialReaderReturnTarget(
      productProgrammeHref(soleMembership.series.slug),
    );
  }
  return returnTarget;
}
