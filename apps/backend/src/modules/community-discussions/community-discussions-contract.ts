import type {
  CommunityDiscussionsSuccess,
  DiscussionErrorCode,
} from "@inside/contracts/community-discussions";

export type CommunityDiscussionsFailureCode =
  | DiscussionErrorCode
  | "invalid_input"
  | "link_required"
  | "provider_unavailable"
  | "provider_invalid_response";
export type CommunityDiscussionsResult =
  | { readonly ok: true; readonly value: CommunityDiscussionsSuccess }
  | {
      readonly ok: false;
      readonly error: { readonly code: CommunityDiscussionsFailureCode };
    };

export function discussionsFailure(
  code: CommunityDiscussionsFailureCode,
): Extract<CommunityDiscussionsResult, { ok: false }> {
  return { ok: false, error: { code } };
}
