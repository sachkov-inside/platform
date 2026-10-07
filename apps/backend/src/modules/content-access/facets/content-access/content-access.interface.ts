import type { AccountId } from "../../../accounts/index.js";
import type { MaterialId } from "../../../../infrastructure/contracts/material-id.js";

export type Subject =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "account"; accountId: AccountId }>;

export const anonymousSubject: Subject = Object.freeze({ kind: "anonymous" });

export type MaterialResource = Readonly<{
  kind: "material";
  materialId: MaterialId;
}>;

export type AssetResource = Readonly<{
  kind: "asset";
  assetId: string;
}>;

export type VideoResource = Readonly<{
  kind: "video";
  videoId: string;
}>;

export type GuideArtifactResource = Readonly<{
  artifactId: string;
  kind: "guideArtifact";
}>;

/** A Guide Task (#946): its own access class on its Guide; unpublished, only its author reads it. */
export type GuideTaskResource = Readonly<{
  kind: "guideTask";
  taskId: string;
}>;

export type Resource =
  | MaterialResource
  | AssetResource
  | GuideArtifactResource
  | GuideTaskResource
  | VideoResource;

export type AccessAction = "read" | "preview" | "download" | "play";

export type EnforcementPoint =
  | "material_open"
  | "personal_home"
  | "reading_state_change"
  | "bookmark_change"
  | "published_material_read"
  | "material_preview"
  | "mcp_material_read"
  | "asset_delivery"
  | "download_delivery"
  | "guide_artifact_read"
  | "guide_artifact_delivery"
  | "guide_task_read"
  | "guide_task_submit"
  | "playback_token_issue"
  | "video_authorization_callback";

export interface AccessOperation {
  readonly itemId: string;
  readonly resource: Resource;
  readonly action: AccessAction;
}

export interface AccessBatchRequest {
  readonly subject: Subject;
  readonly operations: readonly AccessOperation[];
  readonly enforcementPoint: EnforcementPoint;
  readonly correlationId: string;
}

export interface AccessRequest {
  readonly subject: Subject;
  readonly resource: Resource;
  readonly action: AccessAction;
  readonly enforcementPoint: EnforcementPoint;
  readonly correlationId: string;
}

export interface AccessAvailability {
  readonly itemId: string;
  readonly availability: "available" | "locked" | "unavailable";
}

export type AvailabilityBatchResult =
  | Readonly<{ ok: true; items: readonly AccessAvailability[] }>
  | Readonly<{
      ok: false;
      error: {
        readonly code: "empty_batch" | "duplicate_item_id" | "batch_too_large";
      };
    }>;

export type DenyReason =
  | "authentication_required"
  | "membership_required"
  | "membership_expired"
  | "entitlement_stale"
  | "permission_required"
  | "resource_unpublished"
  | "resource_not_found"
  | "resource_mismatch"
  | "resource_action_invalid"
  | "dependency_unavailable";

interface DecisionMetadata {
  readonly decisionId: string;
  readonly policyVersion: "content-access-v1";
  readonly decidedAt: string;
}

export type AccessDecision = DecisionMetadata &
  (
    | Readonly<{
        effect: "allow";
        reason: "public_resource" | "materials_manager";
        checkedContentVersion: number;
      }>
    | Readonly<{
        effect: "allow";
        reason: "active_membership";
        validUntil: string | null;
        checkedContentVersion: number;
      }>
    | Readonly<{ effect: "deny"; reason: DenyReason }>
  );

export interface GuideAccessRequest {
  readonly subject: Subject;
  readonly guideId: string;
}

/**
 * Открыт ли Guide целиком этому Subject: то же решение по основаниям, что открывает его платные
 * материалы, но без перечисления материалов. `unavailable` — ответа нет, основание не прочитано.
 */
export type GuideAccess = Readonly<{
  kind: "open" | "closed" | "unavailable";
}>;

export interface ContentAccess {
  checkAvailabilityMany(
    input: AccessBatchRequest,
  ): Promise<AvailabilityBatchResult>;
  authorize(input: AccessRequest): Promise<AccessDecision>;
  checkGuideAccess(input: GuideAccessRequest): Promise<GuideAccess>;
}
