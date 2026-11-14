import type { Route } from "next";
import { type ReaderCourseAnchor } from "@/shared/routing/reader-course-anchor";
import {
  resolveCourseReading,
  courseBodyLinkHref,
  type CourseReadingContext,
  type ProductChapter,
} from "@/features/library-discovery";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

import {
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";

interface ProductContextMaterial {
  readonly slug: string;
  readonly title: string;
  readonly materialId?: string | undefined;
  readonly access?: "free" | "closed" | undefined;
  readonly availability?: "available" | "locked" | "unavailable" | undefined;
}

interface ProductContextSource {
  readonly programmePlacements?:
    | readonly {
        readonly id: string;
        readonly materialId: string;
        readonly chapterId: string | null;
        readonly stepGroup: string | null;
      }[]
    | undefined;
  readonly chapters?: readonly ProductChapter[];
  readonly items: readonly ProductContextMaterial[];
  readonly kind: "ready";
  readonly reference: {
    readonly name: string;
    readonly slug: string;
  };
}

export interface ProductReaderContextItem {
  readonly href: Route;
  readonly title: string;
}

export interface ProductReaderContext {
  /** Displayed supplementary content stays outside the primary sequence. */
  readonly supplementary?: boolean;
  readonly displayedTitle?: string;
  readonly programme?: CourseReadingContext | null;
  readonly currentPosition: number;
  readonly next: ProductReaderContextItem | null;
  readonly previous: ProductReaderContextItem | null;
  readonly product: {
    readonly href: Route;
    readonly name: string;
  };
  readonly totalMaterials: number;
}

export function resolveProductReaderContext({
  currentMaterialSlug,
  returnTarget,
  product,
  anchor,
  placementId,
  referenceView = false,
}: {
  readonly placementId?: string | undefined;
  readonly referenceView?: boolean;
  readonly currentMaterialSlug: string;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly product: ProductContextSource;
  readonly anchor?: ReaderCourseAnchor | undefined;
}): ProductReaderContext | null {
  if (
    returnTarget.kind !== "product" ||
    returnTarget.productSlug === undefined ||
    returnTarget.productSlug !== product.reference.slug
  ) {
    return null;
  }

  const currentIndex = product.items.findIndex(
    ({ slug }) => slug === currentMaterialSlug,
  );
  if (currentIndex === -1) return null;
  const flatProgramme =
    product.programmePlacements === undefined
      ? product.items.map((item) => ({ item, placementId: undefined }))
      : product.programmePlacements.flatMap((placement) => {
          const item = product.items.find(
            (entry) => entry.materialId === placement.materialId,
          );
          return item === undefined
            ? []
            : [{ item, placementId: placement.id }];
        });
  const flatIndex = flatProgramme.findIndex(
    (entry) =>
      entry.item.slug === currentMaterialSlug &&
      (placementId === undefined || entry.placementId === placementId),
  );
  const programmeHref = productProgrammeHref(product.reference.slug);
  const resolution =
    product.chapters === undefined || product.chapters.length === 0
      ? undefined
      : resolveCourseReading({
          product: { ...product, chapters: product.chapters },
          current: { kind: "material", slug: currentMaterialSlug, placementId },
          referenceView,
          returnTarget,
          anchor,
        });
  const supplementary =
    resolution?.supplementary ?? (referenceView || flatIndex < 0);
  const programme =
    resolution === undefined
      ? supplementary && anchor !== undefined
        ? null
        : undefined
      : resolution.programme;
  if (programme === null) return null;

  return {
    ...(supplementary
      ? {
          supplementary: true,
          displayedTitle:
            product.items[currentIndex]?.title ?? currentMaterialSlug,
        }
      : {}),
    ...(programme === undefined ? {} : { programme }),
    currentPosition:
      programme?.currentPosition === 0
        ? 0
        : (programme?.current.materialOrdinal ??
          programme?.currentPosition ??
          flatIndex + 1),
    next: supplementary
      ? null
      : (programme?.next ??
        (programme === undefined
          ? toContextItem(
              flatProgramme[flatIndex + 1]?.item,
              returnTarget.href,
              flatProgramme[flatIndex + 1]?.placementId,
            )
          : null)),
    previous: supplementary
      ? null
      : (programme?.previous ??
        (programme === undefined
          ? toContextItem(
              flatProgramme[flatIndex - 1]?.item,
              returnTarget.href,
              flatProgramme[flatIndex - 1]?.placementId,
            )
          : null)),
    product: {
      href:
        returnTarget.href.split("?")[0] === programmeHref
          ? returnTarget.href
          : programmeHref,
      name: product.reference.name,
    },
    totalMaterials:
      programme?.totalMaterials ??
      new Set(flatProgramme.map((entry) => entry.item.slug)).size,
  };
}

/**
 * A body link to a primary step of this programme opens that step, whether the open document is a
 * lesson or a supplementary document: selecting a primary step ends supplementary browsing. Any other
 * Material opens as a reference that keeps the reader's step when the open document has one. Other
 * addresses are not course links.
 */
export function readerBodyLinkHref(
  productContext: ProductReaderContext | null,
  href: string,
): Route | undefined {
  const programme = productContext?.programme;
  if (programme == null) return undefined;
  return courseBodyLinkHref(programme, href);
}

function toContextItem(
  material: ProductContextMaterial | undefined,
  productHref: Route,
  placementId?: string,
): ProductReaderContextItem | null {
  return material === undefined
    ? null
    : {
        href: materialReaderHref(material.slug, productHref, { placementId }),
        title: material.title,
      };
}
