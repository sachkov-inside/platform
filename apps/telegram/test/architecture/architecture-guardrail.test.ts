import type { DatabaseSchema } from "../../src/database/database.js";
import { hasText } from "../../src/shared/text.js";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("architecture guardrail", () => {
  it("accepts the application source", () => {
    const result = runGuardrail();

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  it.each([
    [
      "adapter-imports-persistence",
      "adapters/telegram/transport-with-domain-decision.ts: transport adapter imports ../../database/create-database.js",
    ],
    [
      "module-imports-adapter",
      "modules/sign-in/sign-in.ts: module imports adapters/telegram/translate.ts",
    ],
    [
      "module-imports-transport",
      "modules/contacts/contacts.ts: module imports transport package grammy",
    ],
    [
      "module-imports-application",
      "modules/contacts/contacts.ts: module imports application/contact-effects.ts",
    ],
    ["module-calls-fetch", "modules/contacts/contacts.ts: module calls fetch"],
    [
      "shared-imports-module",
      "shared/clock.ts: shared kernel imports modules/contacts/contacts.ts",
    ],
    ["module-cycle", "module cycle: contacts -> marketing -> contacts"],
    [
      "pure-dialog-imports-io",
      "modules/communications/author-transition.ts: pure author dialog imports database/drafts.ts",
    ],
    [
      "pure-dialog-imports-io",
      "modules/communications/author-funnels.ts: pure author dialog imports database/drafts.ts",
    ],
    [
      "pure-dialog-imports-io",
      "modules/communications/author-composer.ts: pure author dialog imports node:crypto",
    ],
    [
      "foreign-table-access",
      "modules/marketing/marketing.ts: platform_links is owned by modules/identity-linking",
    ],
  ])("rejects %s", (fixture, violation) => {
    const result = runGuardrail(`test/architecture/fixtures/${fixture}/src`);

    expect(result.stdout.split("\n")).toContain(violation);
    expect(result.status).toBe(1);
  });
});

it("lets the pure author dialog import types from anywhere", () => {
  const result = runGuardrail(
    "test/architecture/fixtures/pure-dialog-imports-io/src",
  );

  expect(result.stdout).not.toContain("author-turn.ts");
});

function runGuardrail(root?: string) {
  return spawnSync(
    process.execPath,
    ["scripts/check-architecture.mjs", ...(hasText(root) ? [root] : [])],
    { encoding: "utf8", timeout: 10_000 },
  );
}

const currentTableOwners = {
  activation_attempts: "subscription-activation",
  activation_review_requests: "subscription-activation",
  bot_contact_events: "bot-contacts",
  bot_contacts: "bot-contacts",
  communication_author_compositions: "communications",
  communication_author_drafts: "communications",
  communication_author_modes: "communications",
  communication_author_outbox: "communications",
  communication_author_receipts: "communications",
  communication_author_sessions: "communications",
  communication_broadcasts: "communications",
  communication_contacts: "communications",
  communication_deliveries: "communications",
  communication_enrollments: "communications",
  communication_entries: "communications",
  communication_funnels: "communications",
  communication_intake_receipts: "communications",
  communication_intro: "communications",
  communication_operations: "communications",
  communication_preferences: "communications",
  communication_publications: "communications",
  communication_sources: "communications",
  communication_step_ids: "communications",
  communication_templates: "communications",
  communication_tracking_hits: "communications",
  communication_tracking_tokens: "communications",
  community_bindings: "community",
  community_desired_states: "community",
  community_effect_attempts: "community",
  community_effects: "community",
  community_operations: "community",
  community_restriction_decisions: "community",
  identity_link_events: "identity-linking",
  identity_link_recoveries: "identity-linking",
  invitation_redemptions: "subscription-activation",
  link_transactions: "identity-linking",
  membership_check_results: "membership-evidence",
  membership_checks: "membership-evidence",
  membership_event_audit: "membership-evidence",
  membership_evidence_outbox: "membership-evidence",
  membership_provider_observations: "membership-evidence",
  membership_provider_state: "membership-evidence",
  membership_reconciliations: "membership-evidence",
  notification_attempts: "notifications",
  notification_commands: "notifications",
  notification_deliveries: "notifications",
  notification_quarantine: "notifications",
  notification_result_outbox: "notifications",
  platform_links: "identity-linking",
  sales_funnel_event_outbox: "sales-funnel",
  sign_in_requests: "bot-sign-in",
  sign_in_subjects: "bot-sign-in",
  start_response_deliveries: "outbound",
  start_response_delivery_attempts: "outbound",
  telegram_identity_reservations: "identity-linking",
  telegram_transport_fairness: "outbound",
  telegram_transport_slots: "outbound",
  telegram_updates: "update-inbox",
} satisfies Record<keyof DatabaseSchema, string>;

it("accepts current table owners and transaction handoff without foreign table access", () => {
  const result = runGuardrail(
    "test/architecture/fixtures/current-table-owners/src",
  );
  expect(result.stdout).toBe("");
  expect(result.status).toBe(0);
});

it.each(Object.entries(currentTableOwners))(
  "rejects foreign access to %s owned by %s",
  (table, owner) => {
    const result = runGuardrail(
      "test/architecture/fixtures/current-foreign-tables/src",
    );
    expect(result.stdout.split("\n")).toContain(
      `modules/foreign/access.ts: ${table} is owned by modules/${owner}`,
    );
    expect(result.status).toBe(1);
  },
);

const formerLegacyAccess: readonly (readonly [
  string,
  readonly (keyof DatabaseSchema)[],
])[] = [
  // Create the communication contact atomically with the first bot contact.
  ["modules/bot-contacts/bot-contacts.ts", ["communication_contacts"]],
  // Reserve the identity-link transaction atomically when consuming sign-in approval.
  ["modules/bot-sign-in/sign-in-account-link.ts", ["link_transactions"]],
  // Read private-chat reachability when selecting communication recipients.
  ["modules/communications/broadcasts.ts", ["bot_contacts"]],
  // Read private-chat reachability when selecting communication recipients.
  ["modules/communications/communication-statistics.ts", ["bot_contacts"]],
  // Read private-chat reachability when selecting communication recipients.
  ["modules/communications/funnel-preview.ts", ["bot_contacts"]],
  // Read private-chat reachability when selecting communication recipients.
  ["modules/communications/funnel-scheduler.ts", ["bot_contacts"]],
  // Persist a confirmed transport block under the communication contact lock.
  ["modules/communications/delivery-contactability.ts", ["bot_contacts"]],
  // Read private-chat reachability before a community welcome delivery.
  ["modules/community/community-provider.ts", ["bot_contacts"]],
  // Queue initial membership evidence atomically with identity recovery.
  ["modules/identity-linking/identity-link-recovery.ts", ["membership_checks"]],
  // Queue initial membership evidence atomically with linking; linking also consumes sign-in state.
  [
    "modules/identity-linking/identity-linking.ts",
    ["membership_checks", "sign_in_requests", "sign_in_subjects"],
  ],
  // Read the contact destination for membership-check replies.
  [
    "modules/membership-evidence/membership-evidence-provider.ts",
    ["bot_contacts"],
  ],
  // Read reachability when authorizing notification delivery.
  ["modules/notifications/notification-provider.ts", ["bot_contacts"]],
  // Legacy schema declaration; outbound owns the runtime transport cursor.
  [
    "modules/notifications/notification-storage.ts",
    ["telegram_transport_fairness"],
  ],
  // Read sign-in and linking state to suppress stale queued replies.
  [
    "modules/outbound/start-response-delivery-queue.ts",
    ["link_transactions", "sign_in_requests"],
  ],
  // Create and read the stable source contact in the event transaction.
  [
    "modules/sales-funnel/sales-funnel-events.ts",
    ["bot_contacts", "communication_contacts"],
  ],
  // Legacy schema declaration; identity-linking owns identity reservation.
  [
    "modules/subscription-activation/activation-storage.ts",
    ["telegram_identity_reservations"],
  ],
  // Operator readiness counts; no product writes.
  [
    "operations/check-readiness.ts",
    ["bot_contacts", "identity_link_recoveries", "membership_reconciliations"],
  ],
  // Operator proof reads persisted evidence; no product writes.
  [
    "operations/credentialed-proof.ts",
    [
      "bot_contacts",
      "identity_link_events",
      "identity_link_recoveries",
      "link_transactions",
      "membership_check_results",
      "membership_checks",
      "membership_event_audit",
      "membership_evidence_outbox",
      "membership_provider_observations",
      "membership_provider_state",
      "membership_reconciliations",
      "telegram_updates",
    ],
  ],
  // Read known contact and community IDs in one repeatable-read snapshot.
  [
    "operations/group-report-candidates.ts",
    ["bot_contacts", "community_bindings"],
  ],
];

it.each(formerLegacyAccess)(
  "rejects every former exception in %s",
  (file, tables) => {
    const result = runGuardrail(
      "test/architecture/fixtures/legacy-access-allowed/src",
    );
    for (const table of tables) {
      const owner = currentTableOwners[table];
      expect(result.stdout.split("\n")).toContain(
        `${file}: ${table} is owned by modules/${owner}`,
      );
    }
    expect(result.status).toBe(1);
  },
);

it.each([
  "modules/bot-contacts/bot-contacts.ts",
  "modules/bot-sign-in/sign-in-account-link.ts",
  "modules/communications/broadcasts.ts",
  "modules/communications/communication-statistics.ts",
  "modules/communications/funnel-preview.ts",
  "modules/communications/funnel-scheduler.ts",
  "modules/communications/delivery-contactability.ts",
  "modules/community/community-provider.ts",
  "modules/identity-linking/identity-link-recovery.ts",
  "modules/identity-linking/identity-linking.ts",
  "modules/membership-evidence/membership-evidence-provider.ts",
  "modules/notifications/notification-provider.ts",
  "modules/notifications/notification-storage.ts",
  "modules/outbound/start-response-delivery-queue.ts",
  "modules/sales-funnel/sales-funnel-events.ts",
  "modules/subscription-activation/activation-storage.ts",
  "operations/check-readiness.ts",
  "operations/credentialed-proof.ts",
  "operations/group-report-candidates.ts",
])("does not exempt other tables in legacy file %s", (file) => {
  const result = runGuardrail(
    "test/architecture/fixtures/legacy-access-forbidden/src",
  );
  expect(result.stdout.split("\n")).toContain(
    file.startsWith("modules/subscription-activation/")
      ? `${file}: bot_contact_events is owned by modules/bot-contacts`
      : `${file}: invitation_redemptions is owned by modules/subscription-activation`,
  );
  expect(result.status).toBe(1);
});
