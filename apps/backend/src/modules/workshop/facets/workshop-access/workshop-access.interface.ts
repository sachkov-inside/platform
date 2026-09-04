import type { AccountId } from "../../../accounts/index.js";
import type { WorkshopEntitlements } from "../workshop-entitlements/workshop-entitlements.interface.js";

export type WorkshopSubject =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "account"; accountId: AccountId }>;

export type WorkshopResourceKind =
  | "track_outline"
  | "laboratory"
  | "production_case"
  | "laboratory_artifact"
  | "production_case_artifact";

export interface WorkshopResource {
  readonly kind: WorkshopResourceKind;
  readonly resourceId: string;
}

export type WorkshopAction =
  | "read"
  | "download"
  | "read_progress"
  | "write_progress";

export type WorkshopEnforcementPoint =
  | "track_outline_read"
  | "laboratory_read"
  | "production_case_read"
  | "laboratory_progress_read"
  | "laboratory_progress_write"
  | "workshop_artifact_delivery";

export interface WorkshopAccessRequest {
  readonly subject: WorkshopSubject;
  readonly resource: WorkshopResource;
  readonly action: WorkshopAction;
  readonly enforcementPoint: WorkshopEnforcementPoint;
  readonly correlationId: string;
}

export interface WorkshopAccessOperation {
  readonly itemId: string;
  readonly resource: WorkshopResource;
  readonly action: WorkshopAction;
}

export interface WorkshopAvailabilityRequest {
  readonly operations: readonly WorkshopAccessOperation[];
  readonly enforcementPoint: WorkshopEnforcementPoint;
  readonly correlationId: string;
}

export type WorkshopAvailability = "public" | "included" | "unavailable";

export type WorkshopAvailabilityResult =
  | Readonly<{
      ok: true;
      items: readonly Readonly<{
        itemId: string;
        availability: WorkshopAvailability;
      }>[];
    }>
  | Readonly<{
      ok: false;
      error: {
        readonly code:
          | "empty_batch"
          | "duplicate_item_id"
          | "batch_too_large";
      };
    }>;

export type WorkshopAccessDenyReason =
  | "authentication_required"
  | "workshop_access_required"
  | "workshop_access_expired"
  | "entitlement_stale"
  | "resource_unpublished"
  | "resource_not_found"
  | "resource_mismatch"
  | "resource_action_invalid"
  | "dependency_unavailable";

interface WorkshopDecisionMetadata {
  readonly decisionId: string;
  readonly policyVersion: "workshop-access-v1";
  readonly decidedAt: string;
}

export type WorkshopAccessDecision = WorkshopDecisionMetadata &
  (
    | Readonly<{
        effect: "allow";
        reason: "public_resource" | "authenticated_account";
      }>
    | Readonly<{
        effect: "allow";
        reason: "active_workshop";
        validUntil: string;
      }>
    | Readonly<{
        effect: "deny";
        reason: WorkshopAccessDenyReason;
      }>
  );

export type WorkshopResourceFacts =
  | Readonly<{
      resource: WorkshopResource & { readonly kind: "track_outline" };
      publicationState: "draft" | "published" | "withdrawn";
      access: "public";
    }>
  | Readonly<{
      resource: WorkshopResource & {
        readonly kind: Exclude<WorkshopResourceKind, "track_outline">;
      };
      publicationState: "draft" | "published" | "withdrawn";
      access: "public" | "workshop";
    }>;

export interface WorkshopResourceFactsAdapter {
  findMany(
    resources: readonly WorkshopResource[],
  ): Promise<readonly WorkshopResourceFacts[]>;
  findOne(resource: WorkshopResource): Promise<WorkshopResourceFacts | null>;
}

export interface WorkshopAccessDependencies {
  readonly resourceFacts: WorkshopResourceFactsAdapter;
  readonly workshopEntitlements: Pick<WorkshopEntitlements, "resolveForAccess">;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
}

export interface WorkshopAccess {
  checkAvailabilityMany(
    request: WorkshopAvailabilityRequest,
  ): Promise<WorkshopAvailabilityResult>;
  authorize(request: WorkshopAccessRequest): Promise<WorkshopAccessDecision>;
}
