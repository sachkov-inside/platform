export { BillingModule } from "./billing.module.js";
export { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
export { assembleBillingNotificationOutbox } from "./facets/notification-outbox/notification-outbox.js";

export { BillingNotices } from "./facets/billing-notices/billing-notices.js";
export { BillingPayments } from "./facets/billing-payments/billing-payments.js";
export { BillingSubscriptions } from "./facets/billing-subscriptions/billing-subscriptions.js";
export { BillingOperations } from "./facets/billing-operations/billing-operations.js";
export { registerBillingTools, type BillingOwnerTools } from "./adapters/mcp/register-billing-tools.js";

// Подпись протокола банка нужна и вне модуля: двойник банка на стенде подписывает нотификации
// тем же алгоритмом, иначе приложение не приняло бы их своим обычным путём.
export { tbankToken } from "./infrastructure/tbank/tbank.js";
