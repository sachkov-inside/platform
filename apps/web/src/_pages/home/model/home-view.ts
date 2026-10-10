import type {
  ProductPageCard,
  ProductPageHero,
  ProductPresentation,
} from "@/entities/product-page";
import type { ContentCover, MaterialPreview } from "@/entities/material";

export interface HomeCollection {
  readonly count: number;
  readonly cover: ContentCover | null;
  readonly id: string;
  readonly name: string;
  readonly previewItems: readonly MaterialPreview[];
  readonly slug: string;
  readonly summary: string | null;
}

/** Закреплённый продукт знает, каким оформлением нарисовать свою карточку (ADR 0026). */
export interface HomePinnedCollection extends HomeCollection {
  readonly presentation: ProductPresentation;
  readonly card: ProductPageCard | null;
  /** Первый экран страницы продукта: оформление курса повторяет его на Главной. */
  readonly hero: ProductPageHero | null;
  /** «до старта N дней» — наклейка на анимации, пока поток набирается; иначе нет. */
  readonly startCountdown?: string | null;
}

export interface HomeView {
  readonly pinnedSeries: HomePinnedCollection | null;
  /** Existing backend home projection; purchase calls to action are not rendered here. */
  readonly membership:
    | { readonly kind: "active" }
    | { readonly kind: "inactive" }
    | { readonly kind: "notOffered" }
    | { readonly kind: "unknown" };
  readonly guides: readonly MaterialPreview[];
  readonly notes: readonly MaterialPreview[];
  readonly playlists: readonly HomeCollection[];
  readonly topics: readonly HomeCollection[];
  readonly videos: readonly MaterialPreview[];
}

export type HomeResult =
  | { readonly kind: "ready"; readonly value: HomeView }
  | { readonly kind: "unavailable" };
