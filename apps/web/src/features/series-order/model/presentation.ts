export interface SeriesOrderItemPresentation {
  readonly materialId: string;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly title: string;
}

export interface SeriesOrderPresentation {
  readonly items: readonly SeriesOrderItemPresentation[];
  readonly name: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly orderVersion: string;
  readonly seriesId: string;
}

export type SeriesOrderActionState =
  | { readonly kind: "idle" }
  | { readonly kind: "saved"; readonly orderVersion: string }
  | { readonly kind: "conflict" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly reference: string };

export type SeriesOrderMutation = (
  state: SeriesOrderActionState,
  formData: FormData,
) => Promise<SeriesOrderActionState>;
