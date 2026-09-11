import type { MaterialId } from "../../../../src/modules/materials/domain/material-identifiers.js";
import type { AccountId } from "../../../../src/modules/accounts/domain/account-identifiers.js";
import type {
  AccountsPrisma,
  MaterialsPrismaClient,
} from "../../../../src/infrastructure/prisma/index.js";
declare const accountId: AccountId;
declare function materialsTable(table: "materials.materials"): void;
declare const accountsPrisma: AccountsPrisma;
declare const materialsPrisma: MaterialsPrismaClient;

const materialId: MaterialId = accountId;
materialsTable("accounts.accounts");
await materialsPrisma.$transaction(async (transaction) =>
  transaction.account.count(),
);
await accountsPrisma.material.count();

describe("production code", () => materialId);

import type { ReadingActivityPrismaClient } from "../../../../src/infrastructure/prisma/index.js";
declare const readingPrisma: ReadingActivityPrismaClient;
await readingPrisma.material.count();
await materialsPrisma.readingMaterialState.count();

import type { MembershipEntitlementsPrismaClient } from "../../../../src/modules/membership-entitlements/infrastructure/prisma.js";
declare const entitlementsPrisma: MembershipEntitlementsPrismaClient;
await accountsPrisma.accessGrant.count();
await materialsPrisma.legacyClassification.count();
await entitlementsPrisma.account.count();
// Billing contact persistence is owned by Accounts, never Materials.
declare const foreignBillingPrisma: import("../../../../src/infrastructure/prisma/index.js").MaterialsPrisma;
foreignBillingPrisma.billingContact.findMany();
foreignBillingPrisma.billingConsentEvidence.findMany();

// Notifications cannot read contacts; Accounts cannot operate delivery attempts.
declare const notificationsPrisma: import("../../../../src/infrastructure/prisma/index.js").NotificationsPrisma;
notificationsPrisma.billingContact.findMany();
accountsPrisma.notificationEmailAttempt.findMany();

// Community delivery state belongs to Telegram Membership; access grants never do.
declare const telegramCommunityPrisma: import("../../../../src/infrastructure/prisma/index.js").TelegramMembershipPrisma;
telegramCommunityPrisma.accessGrant.count();
entitlementsPrisma.telegramCommunityOperation.count();

// Каждый источник Notifications обязан назвать своего владельца: пропущенный тип события
// должен ломать сборку, а не молча спрашивать чужой повод.
import type { NotificationEvent } from "../../../../src/modules/notifications/domain/notification-wire.js";
import type { NotificationSource } from "../../../../src/modules/notifications/ports/notification-sources.js";
declare const resolveBillingNotice: () => Promise<NotificationSource>;
({ "billing.notice-ready": resolveBillingNotice }) satisfies Record<
  NotificationEvent["eventType"],
  () => Promise<NotificationSource>
>;
