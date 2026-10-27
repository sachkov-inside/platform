import type { ProductProgrammePlacement } from "../../shared/product-chapters.js";
type PublicationState = "draft" | "published" | "unpublished";
import type {
  ForbiddenError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";

export interface ProductChapterDto {
  readonly supplementaryMaterialIds?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
  readonly summary: string;
}

export interface ProductOrderMaterialDto {
  readonly chapterId: string | null;
  readonly materialId: string;
  readonly ordinal: number;
  readonly stepGroup: string | null;
  readonly publicationState: PublicationState;
  readonly title: string | null;
}

export interface ProductOrderDto {
  readonly programmePlacements: readonly ProductProgrammePlacement[];
  readonly archived: boolean;
  readonly chapters: readonly ProductChapterDto[];
  readonly items: readonly ProductOrderMaterialDto[];
  readonly name: string;
  readonly orderVersion: string;
  readonly productId: string;
}

export interface LoadProductOrderQuery {
  readonly actor: string;
  readonly productId: string;
}

export type ProductNotFoundError = { readonly code: "product_not_found" };
export type LoadProductOrderError =
  ForbiddenError | ProductNotFoundError | SystemError;
export type LoadProductOrderResult = Result<
  ProductOrderDto,
  LoadProductOrderError
>;
export type LoadProductOrderOperation = (
  query: LoadProductOrderQuery,
) => Promise<LoadProductOrderResult>;
