import { acceptBillingConsentsOperation } from "./billing-consents.operation";

/**
 * Одна команда согласия обслуживает и первую покупку, и возобновление списаний: контекст
 * различает их, а редакции документов приходят с сервера.
 */
export const acceptBillingConsents = acceptBillingConsentsOperation.send;
