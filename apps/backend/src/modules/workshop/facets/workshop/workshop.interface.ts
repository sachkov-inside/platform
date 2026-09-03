import type { AccountId } from "../../../accounts/index.js";
import type { WorkshopMaterialAccess } from "../workshop-material-access/workshop-material-access.interface.js";
import type { WorkshopMaterialProtection } from "../workshop-material-protection/workshop-material-protection.interface.js";

export interface GrantWorkshopEntitlementCommand {
  readonly actorAccountId: AccountId;
  readonly targetAccountId: AccountId;
  readonly workshopScope: string;
  readonly startsAt: string;
  readonly validUntil: string;
  readonly grantSource: "owner_beta";
  readonly idempotencyKey: string;
}

export interface WorkshopEntitlementDto {
  readonly entitlementId: string;
  readonly workshopScope: string;
  readonly startsAt: string;
  readonly validUntil: string;
}

export type WorkshopMaterialRole =
  | "prerequisite"
  | "optional_reference"
  | "hint"
  | "exact_solution"
  | "walkthrough"
  | "alternatives";

export type WorkshopMaterialReleasePolicy =
  | Readonly<{ kind: "immediate" }>
  | Readonly<{ kind: "hint_reveal"; hintKey: string }>
  | Readonly<{ kind: "solution_reveal" }>;

export interface PublishWorkshopCaseCommand {
  readonly actorAccountId: AccountId;
  readonly caseSlug: string;
  readonly workshopScope: string;
  readonly caseVersion: string;
  readonly schemaVersion: string;
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly caseSpec: unknown;
  readonly contentDigest: string;
  readonly artifacts: readonly {
    readonly name: string;
    readonly body: Uint8Array;
    readonly contentType: string;
    readonly retentionTime: string;
  }[];
  readonly materials: readonly {
    readonly materialId: string;
    readonly role: WorkshopMaterialRole;
    readonly ordinal: number;
    readonly releasePolicy: WorkshopMaterialReleasePolicy;
  }[];
  readonly idempotencyKey: string;
}

export interface PublishedWorkshopCaseDto {
  readonly caseId: string;
  readonly caseSlug: string;
  readonly caseVersionId: string;
  readonly caseVersion: string;
  readonly contentDigest: string;
  readonly publishedAt: string;
}

export type PublishWorkshopCaseResult =
  | Readonly<{ ok: true; value: PublishedWorkshopCaseDto }>
  | Readonly<{
      ok: false;
      error: {
        readonly code:
          | "artifact_unavailable"
          | "dependency_unavailable"
          | "forbidden"
          | "idempotency_key_reused"
          | "invalid_case_spec"
          | "invalid_material"
          | "invalid_request"
          | "publication_conflict";
      };
    }>;

export type LoadWorkshopCaseResult =
  | Readonly<{ ok: true; value: PublishedWorkshopCaseDto }>
  | Readonly<{
      ok: false;
      error: {
        readonly code:
          | "case_not_found"
          | "dependency_unavailable"
          | "invalid_request";
      };
    }>;

export type GrantWorkshopEntitlementResult =
  | Readonly<{ ok: true; value: WorkshopEntitlementDto }>
  | Readonly<{
      ok: false;
      error: {
        readonly code:
          | "dependency_unavailable"
          | "forbidden"
          | "idempotency_key_reused"
          | "invalid_request"
          | "membership_required";
      };
    }>;

export type WorkshopAccessState =
  | Readonly<{ kind: "active"; startsAt: string; validUntil: string }>
  | Readonly<{ kind: "expired" | "not_started" | "required" | "unavailable" }>;

export interface RevealWorkshopHintCommand {
  readonly accountId: AccountId;
  readonly caseVersionId: string;
  readonly hintKey: string;
  readonly idempotencyKey: string;
}

export interface RevealWorkshopSolutionCommand {
  readonly accountId: AccountId;
  readonly caseVersionId: string;
  readonly idempotencyKey: string;
}

export interface WorkshopRevealDto {
  readonly revealId: string;
  readonly caseVersionId: string;
  readonly revealedAt: string;
  readonly reason: "after_attempt" | "learner_requested";
  readonly hintKey?: string;
}

export type WorkshopRevealResult =
  | Readonly<{ ok: true; value: WorkshopRevealDto }>
  | Readonly<{
      ok: false;
      error: {
        readonly code:
          | "access_required"
          | "dependency_unavailable"
          | "idempotency_key_reused"
          | "invalid_request"
          | "material_not_found";
      };
    }>;

export interface Workshop {
  readonly materialAccess: WorkshopMaterialAccess;
  readonly materialProtection: WorkshopMaterialProtection;
  grantEntitlement(
    command: GrantWorkshopEntitlementCommand,
  ): Promise<GrantWorkshopEntitlementResult>;
  resolveAccess(input: {
    readonly accountId: AccountId;
    readonly workshopScope: string;
  }): Promise<WorkshopAccessState>;
  publishCase(
    command: PublishWorkshopCaseCommand,
  ): Promise<PublishWorkshopCaseResult>;
  loadCurrentCase(caseSlug: string): Promise<LoadWorkshopCaseResult>;
  revealHint(command: RevealWorkshopHintCommand): Promise<WorkshopRevealResult>;
  revealSolution(
    command: RevealWorkshopSolutionCommand,
  ): Promise<WorkshopRevealResult>;
}
