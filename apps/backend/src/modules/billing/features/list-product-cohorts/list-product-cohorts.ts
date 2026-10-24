/** Compatibility adapter for the old cohort wire; Product Sales State owns its facts. */
export {
  productSalesListLimit as cohortListLimit,
  productSalesStatesQuerySchema as productCohortsQuerySchema,
  productSalesStatesSchema as productCohortsSchema,
  listProductSalesStates as listProductCohorts,
} from "../list-product-sales-states/list-product-sales-states.js";
