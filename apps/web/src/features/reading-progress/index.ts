export { ReadingAction } from "./ui/reading-action.client";
export { ProductMaterialMarker } from "./ui/product-material-marker.client";
export type {
  ReadingActionProps,
  ReadingActionView,
} from "./model/reading-progress-view";

export { ReadingProgressProvider } from "./ui/reading-provider.client";
export { SavedReadingAction } from "./ui/saved-reading-action.client";
export { VisibleMaterialOpen } from "./ui/visible-material-open.client";
export { readingProgressChanges } from "./model/reading-progress-events";

export {
  productContinuationQueryKey,
  productContinuationProjectionSchema,
  materialResumeSchema,
  continuationLabel,
} from "./model/product-continuation-contract";
export { loadProductContinuation } from "./api/product-continuation.browser";

export {
  LearningContinuation,
  LearningContinuationView,
} from "./ui/learning-continuation.client";
