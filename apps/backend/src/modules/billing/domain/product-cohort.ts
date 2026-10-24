/** Compatibility vocabulary for separately built legacy readers, retired after #1712 proof. */
export {
  productSalesStageSchema as cohortStageSchema,
  productSalesStartSchema as cohortStartSchema,
  productSalesValueSchema as cohortValueSchema,
  productSalesStateSchema as productCohortSchema,
} from "./product-sales-state.js";
export type {
  ProductSalesStage as CohortStage,
  ProductSalesState as ProductCohort,
} from "./product-sales-state.js";
