import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { Database } from "../../database/database.js";
import {
  groupedCounts,
  groupedNonNullCounts,
} from "../../database/diagnostic-counts.js";
import { linkedEvidenceRevisions } from "../identity-linking/platform-links.js";
import { normalizeChatMember } from "./membership-normalization.js";

export interface RedactedMembershipTransition {
  readonly decision: string | null;
  readonly eventDisposition: string | null;
  readonly eventKind: string | null;
  readonly freshnessBounded: boolean;
  readonly freshnessObserved: boolean;
  readonly identityFingerprint: string;
  readonly isCurrentRevision: boolean;
  readonly mappingObserved: boolean;
  readonly normalizedState: string;
  readonly rawIsMember: boolean | null;
  readonly rawStatus: string | null;
  readonly revision: string | null;
  readonly sequence: number;
  readonly source: string | null;
  readonly validitySeconds: number | null;
}

export async function redactedMembershipTransitions(
  database: Database,
): Promise<RedactedMembershipTransition[]> {
  const result = await sql<{
    decision: string | null;
    event_disposition: string | null;
    event_kind: string | null;
    evidence_version: string | null;
    is_current_revision: boolean;
    normalized_state: string;
    raw_is_member: boolean | null;
    raw_status: string | null;
    sequence: string;
    source: string | null;
    telegram_identity_ref: string;
    validity_seconds: string | null;
  }>`
    select
      row_number() over (
        order by results.observed_at, results.id
      )::text as sequence,
      results.telegram_identity_ref,
      outbox.source,
      results.raw_status,
      results.raw_is_member,
      results.normalized_state,
      results.evidence_version::text,
      audit.event_kind,
      audit.disposition as event_disposition,
      outbox.envelope ->> 'decision' as decision,
      case
        when outbox.envelope ->> 'decision' in ('member', 'not_member')
        then round(extract(epoch from (
          (outbox.envelope ->> 'validUntil')::timestamptz
          - (outbox.envelope ->> 'checkedAt')::timestamptz
        )))::text
        else null
      end as validity_seconds,
      results.evidence_version is not null
        and results.evidence_version = links.evidence_version
        as is_current_revision
    from membership_check_results as results
    left join membership_evidence_outbox as outbox
      on outbox.result_ref = results.result_ref
    left join membership_event_audit as audit
      on audit.result_ref = results.result_ref
    inner join (${linkedEvidenceRevisions(database)}) as links
      on links.telegram_identity_ref = results.telegram_identity_ref
    order by results.observed_at, results.id
  `.execute(database);

  return result.rows.map((row) => {
    const normalizedState = validateRecordedMembershipNormalization(row);
    const validitySeconds =
      row.validity_seconds === null ? null : Number(row.validity_seconds);
    const freshnessObserved =
      row.decision === "member" ||
      row.decision === "not_member" ||
      row.decision === "unavailable";
    const freshnessBounded =
      row.decision === "unavailable" ||
      (validitySeconds !== null &&
        validitySeconds > 0 &&
        validitySeconds <= 300);
    if (freshnessObserved && !freshnessBounded) {
      throw new Error("Credentialed proof found unbounded Membership evidence");
    }
    return {
      decision: row.decision,
      eventDisposition: row.event_disposition,
      eventKind: row.event_kind,
      freshnessBounded,
      freshnessObserved,
      identityFingerprint: fingerprint(row.telegram_identity_ref),
      isCurrentRevision: row.is_current_revision,
      mappingObserved: row.raw_status !== null,
      normalizedState,
      rawIsMember: row.raw_is_member,
      rawStatus: row.raw_status,
      revision: row.evidence_version,
      sequence: Number(row.sequence),
      source: row.source,
      validitySeconds,
    };
  });
}

export function validateRecordedMembershipNormalization(row: {
  normalized_state: string;
  raw_is_member: boolean | null;
  raw_status: string | null;
}): string {
  const expected =
    row.raw_status === null
      ? row.normalized_state
      : normalizeChatMember({
          ...(row.raw_is_member === null
            ? {}
            : { isMember: row.raw_is_member }),
          status: row.raw_status,
        });
  if (row.normalized_state !== expected) {
    throw new Error(
      "Credentialed proof found a Membership normalization mismatch",
    );
  }
  return row.normalized_state;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export async function membershipDiagnosticSnapshot(database: Database) {
  const [
    checks,
    deliveries,
    results,
    raw,
    dispositions,
    normalized,
    states,
    observations,
    reconciliations,
    completed,
    transitions,
    versions,
  ] = await Promise.all([
    groupedCounts(database, "membership_checks", "state"),
    groupedCounts(database, "membership_evidence_outbox", "state"),
    groupedCounts(database, "membership_check_results", "normalized_state"),
    groupedNonNullCounts(database, "membership_check_results", "raw_status"),
    groupedCounts(database, "membership_event_audit", "disposition"),
    groupedNonNullCounts(
      database,
      "membership_event_audit",
      "normalized_state",
    ),
    groupedCounts(database, "membership_provider_state", "state"),
    groupedCounts(database, "membership_provider_observations", "state"),
    groupedCounts(database, "membership_reconciliations", "state"),
    sql<{
      count: string;
    }>`select count(*)::text as count from membership_reconciliations where last_completed_at is not null`.execute(
      database,
    ),
    redactedMembershipTransitions(database),
    sql<{
      count: string;
      maximum: string | null;
      minimum: string | null;
    }>`select count(evidence_version)::text as count, min(evidence_version)::text as minimum, max(evidence_version)::text as maximum from membership_check_results where evidence_version is not null`.execute(
      database,
    ),
  ]);
  const range = versions.rows[0];
  return {
    membershipChecksByState: checks,
    evidenceDeliveriesByState: deliveries,
    membershipResultsByNormalizedState: results,
    membershipResultsByRawStatus: raw,
    membershipEventsByDisposition: dispositions,
    membershipEventsByNormalizedState: normalized,
    providerRowsByState: states,
    providerObservationsByState: observations,
    reconciliationsByState: reconciliations,
    reconciliationsCompleted: Number(completed.rows[0]?.count ?? 0),
    membershipTransitions: transitions,
    evidenceVersions: {
      count: Number(range?.count ?? 0),
      maximum: range?.maximum ?? null,
      minimum: range?.minimum ?? null,
    },
  };
}

export async function probeMembershipStorage(database: {
  query(sql: string): Promise<unknown>;
}): Promise<void> {
  await database.query(
    "select count(*) from membership_reconciliations where false",
  );
}
