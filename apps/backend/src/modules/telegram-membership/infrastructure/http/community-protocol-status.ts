import type { CommunityErrorCode } from "../../domain/community-entitlement.js";

/**
 * The protocol's status mapping, owned by transport. Both directions check it: the
 * inbound adapter answers with it, the outbound adapter refuses a response whose HTTP
 * status contradicts its own body.
 */
export const communityErrorStatus: Readonly<Record<CommunityErrorCode, number>> =
  Object.freeze({
    malformed: 400,
    unauthorized: 401,
    not_found: 404,
    operation_conflict: 409,
    revision_conflict: 409,
    binding_conflict: 409,
    unsupported_contract: 422,
    unavailable: 503,
  });
