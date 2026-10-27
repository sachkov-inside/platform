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
  hasProductContext = false,
  inferCourseReturn = false,
}: {
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly material?: Pick<MaterialReaderMetadata, "productMemberships">;
  readonly hasProductContext?: boolean;
  readonly inferCourseReturn?: boolean;
}): MaterialReaderReturnTarget {
  const memberships = material?.productMemberships ?? [];
  if (returnTarget.kind === "product") {
    return hasProductContext ||
      memberships.some(
        ({ product }) => product.slug === returnTarget.productSlug,
      )
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
      productProgrammeHref(soleMembership.product.slug),
    );
  }
  return returnTarget;
}
