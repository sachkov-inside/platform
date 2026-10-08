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

export type ProductArtifactResource = Readonly<{
  artifactId: string;
  kind: "productArtifact";
}>;

/** A Product Task (#946): its own access class on its Product; unpublished, only its author reads it. */
export type ProductTaskResource = Readonly<{
  kind: "productTask";
  taskId: string;
}>;

export type Resource =
  | MaterialResource
  | AssetResource
  | ProductArtifactResource
  | ProductTaskResource
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
  | "product_artifact_read"
  | "product_artifact_delivery"
  | "product_task_read"
  | "product_task_submit"
  | "playback_token_issue"
  | "video_authorization_callback";

export interface AccessOperation {
  readonly itemId: string;
  readonly resource: Resource;
  readonly action: AccessAction;
}

/** Maximum operations in one availability call, including repeated resources. */
export const CONTENT_ACCESS_BATCH_SIZE = 100;

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

export interface ProductAccessRequest {
  readonly subject: Subject;
  readonly productId: string;
}

/**
 * Открыт ли Product целиком этому Subject: то же решение по основаниям, что открывает его платные
 * материалы, но без перечисления материалов. `unavailable` — ответа нет, основание не прочитано.
 */
export type ProductAccess = Readonly<{
  kind: "open" | "closed" | "unavailable";
}>;

export interface ContentAccess {
  checkAvailabilityMany(
    input: AccessBatchRequest,
  ): Promise<AvailabilityBatchResult>;
  authorize(input: AccessRequest): Promise<AccessDecision>;
  checkProductAccess(input: ProductAccessRequest): Promise<ProductAccess>;
}
