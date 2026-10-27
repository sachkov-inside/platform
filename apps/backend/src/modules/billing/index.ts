export { BillingModule } from "./billing.module.js";
export { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
export { assembleBillingNotificationOutbox } from "./facets/notification-outbox/notification-outbox.js";

export {
  registerBillingTools,
  type BillingOwnerTools,
} from "./adapters/mcp/register-billing-tools.js";
export { BillingNotices } from "./facets/billing-notices/billing-notices.js";
export { BillingOperations } from "./facets/billing-operations/billing-operations.js";
export { BillingPayments } from "./facets/billing-payments/billing-payments.js";

// Подпись протокола банка нужна и вне модуля: двойник банка на стенде подписывает нотификации
// тем же алгоритмом, иначе приложение не приняло бы их своим обычным путём.
export { tbankToken } from "./infrastructure/tbank/tbank.js";

export { CourseActivation } from "./facets/course-activation/course-activation.js";

export { BillingProductSales } from "./features/list-product-sales/list-product-sales.js";
export { BillingSurveyRespondentSales } from "./features/read-survey-respondent-sales/read-survey-respondent-sales.js";

export {
  productSaleAvailabilityQuerySchema,
  productSaleAvailabilitySchema,
} from "./features/read-product-sale-availability/read-product-sale-availability.js";

export { PaymentDiagnostics } from "./features/read-payment-diagnostics/payment-diagnostics.js";
export { registerPaymentDiagnosticsTool } from "./features/read-payment-diagnostics/register-payment-diagnostics-tool.js";
