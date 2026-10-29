import type { Route } from "next";
import type { ReaderCourseAnchor } from "@/shared/routing/reader-course-anchor";
import {
  courseReadingContext,
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
    readonly hasModeVariants?: boolean | undefined;
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
    /** Переключатель режима принадлежит руководству, а не отдельному уроку. */
    readonly hasModeVariants: boolean;
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
  const primaryProgramme =
    product.chapters === undefined || product.chapters.length === 0
      ? undefined
      : courseReadingContext({
          product: { ...product, chapters: product.chapters },
          current: { kind: "material", slug: currentMaterialSlug, placementId },
          referenceView,
          returnTarget,
        });
  const supplementary =
    referenceView ||
    (primaryProgramme === undefined && flatIndex < 0) ||
    primaryProgramme === null ||
    primaryProgramme?.activeReferenceId !== undefined;
  const anchoredProgramme =
    supplementary && anchor !== undefined
      ? courseReadingContext({
          product: { ...product, chapters: product.chapters ?? [] },
          current: anchor,
          returnTarget,
        })
      : primaryProgramme;
  // Without an anchor the primary context already carries its own reference selection.
  const reference =
    supplementary && anchor !== undefined
      ? primaryProgramme?.references?.find(
          (item) => item.slug === currentMaterialSlug,
        )
      : undefined;
  const programme =
    anchoredProgramme == null || reference === undefined
      ? anchoredProgramme
      : {
          ...anchoredProgramme,
          activeReferenceId: reference.id,
        };
  if (
    programme === null ||
    (supplementary &&
      anchor !== undefined &&
      (programme?.current.availability !== "available" ||
        programme.currentPosition === 0))
  )
    return null;

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
      hasModeVariants: product.reference.hasModeVariants ?? false,
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
