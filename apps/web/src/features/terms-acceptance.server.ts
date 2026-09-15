/** Server-only interface of the first sign-in screen. */
export { handleAcceptTermsRequest } from "./terms-acceptance/api/accept-terms-route.server";
export { executeAcceptTerms } from "./terms-acceptance/api/accept-terms.server";
export {
  readTermsGate,
  redirectUntilTermsAccepted,
  type TermsGate,
} from "./terms-acceptance/api/terms-gate.server";
