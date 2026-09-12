import { name as readerGuideModeName, statement as readerGuideModeStatement } from "../modules/reading-activity/infrastructure/postgres/migrations/0062-reader-guide-mode.js";
import { name as lessonDifficultyAndOutcomesName, statement as lessonDifficultyAndOutcomesStatement } from "../modules/materials/infrastructure/postgres/migrations/0061-lesson-difficulty-and-outcomes.js";
import { name as materialAnnouncementsName, statement as materialAnnouncementsStatement } from "../modules/materials/infrastructure/postgres/migrations/0060-material-announcements.js";
import { name as oneTimePurchaseName, statement as oneTimePurchaseStatement } from "../modules/billing/infrastructure/postgres/migrations/0059-one-time-purchase.js";
import { name as guideIntroductionName, statement as guideIntroductionStatement } from "../modules/materials/infrastructure/postgres/migrations/0057-guide-introduction.js";
import { name as offerForSaleName, statement as offerForSaleStatement } from "../modules/billing/infrastructure/postgres/migrations/0058-offer-for-sale.js";
import { name as billingNoticesName, statement as billingNoticesStatement } from "../modules/billing/infrastructure/postgres/migrations/0056-billing-notices.js";
import { name as communityEntitlementsName, statement as communityEntitlementsStatement } from "../modules/telegram-membership/infrastructure/postgres/migrations/0053-community-entitlements.js";
import { name as bookmarksName, statement as bookmarksStatement } from "../modules/bookmarks/infrastructure/postgres/migrations/0052-bookmarks.js";
import { name as guideChaptersName, statement as guideChaptersStatement } from "../modules/materials/infrastructure/postgres/migrations/0051-guide-chapters.js";
import { name as guideArtifactsName, statement as guideArtifactsStatement } from "../modules/materials/infrastructure/postgres/migrations/0050-guide-artifacts.js";
import { name as scopedAccessName, statement as scopedAccessStatement } from "../modules/membership-entitlements/infrastructure/postgres/migrations/0046-scoped-access.js";
import { name as subscriptionPaymentsName, statement as subscriptionPaymentsStatement } from "../modules/billing/infrastructure/postgres/migrations/0047-subscription-payments.js";
import { name as subscriptionLifecycleName, statement as subscriptionLifecycleStatement } from "../modules/billing/infrastructure/postgres/migrations/0048-subscription-lifecycle.js";
import { name as billingManagePermissionName, statement as billingManagePermissionStatement } from "../modules/accounts/infrastructure/postgres/migrations/0054-billing-manage-permission.js";
import { name as billingOperationsName, statement as billingOperationsStatement } from "../modules/billing/infrastructure/postgres/migrations/0055-billing-operations.js";
import { name as notificationsName, statement as notificationsStatement } from "../modules/notifications/infrastructure/postgres/migrations/0045-notifications.js";
import { name as notificationsTransportName, statement as notificationsTransportStatement } from "../modules/notifications/infrastructure/postgres/migrations/0044-notification-transport.js";
import { name as materialsTransportName, statement as materialsTransportStatement } from "../modules/materials/infrastructure/postgres/migrations/0043-notification-transport.js";
import { name as billingTransportName, statement as billingTransportStatement } from "../modules/billing/infrastructure/postgres/migrations/0042-notification-transport.js";
import { name as billingPricingName, statement as billingPricingStatement } from "../modules/billing/infrastructure/postgres/migrations/0040-billing-pricing.js";
import { name as telegramLinkRevisionsName, statement as telegramLinkRevisionsStatement } from "../modules/telegram-membership/infrastructure/postgres/migrations/0039-telegram-link-revisions.js";
import { name as accountAccessName, statement as accountAccessStatement } from "../modules/membership-entitlements/infrastructure/postgres/migrations/0038-account-access.js";
import { name as billingContactName, statement as billingContactStatement } from "../modules/accounts/infrastructure/postgres/migrations/0041-billing-contact.js";
import { name as homeSeriesPinName, statement as homeSeriesPinStatement } from "../modules/materials/infrastructure/postgres/migrations/0039-home-series-pin.js";
import { name as homeMaterialPinName, statement as homeMaterialPinStatement } from "../modules/materials/infrastructure/postgres/migrations/0038-home-material-pin.js";
import {
  name as platformAdminName,
  statement as platformAdminStatement,
} from "../modules/accounts/infrastructure/postgres/migrations/0037-platform-admin.js";
import {
  name as domainMaterialFormatsName,
  statement as domainMaterialFormatsStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0035-domain-material-formats.js";
import {
  name as videoUploadRejectionsName,
  statement as videoUploadRejectionsStatement,
} from "../modules/videos/infrastructure/postgres/migrations/0036-video-upload-rejections.js";
import {
  name as materialVisitsName,
  statement as materialVisitsStatement,
} from "../modules/reading-activity/infrastructure/postgres/migrations/0033-material-visits.js";
import {
  name as contentCoverCleanupName,
  statement as contentCoverCleanupStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0034-content-cover-cleanup.js";
import {
  name as readingActivityName,
  statement as readingActivityStatement,
} from "../modules/reading-activity/infrastructure/postgres/migrations/0032-reading-activity.js";
import {
  name as trackingHitsName,
  statement as trackingHitsStatement,
} from "../modules/communications/infrastructure/postgres/migrations/0031-communication-tracking-hits.js";
import {
  name as communicationsPermissionName,
  statement as communicationsPermissionStatement,
} from "../modules/accounts/infrastructure/postgres/migrations/0030-communications-permission.js";
import {
  name as telegramSignInMigrationName,
  statement as telegramSignInMigrationStatement,
} from "../modules/accounts/infrastructure/postgres/migrations/0029-telegram-sign-in.js";
import {
  runMigrationsToLatest,
  type MigrationOutcome,
} from "../infrastructure/postgres/migrate-to-latest.js";
import {
  name as identityPrincipalsMigrationName,
  statement as identityPrincipalsMigrationStatement,
} from "../modules/identity-principals/infrastructure/postgres/migrations/0002_identity_principals.js";
import {
  name as accountsMigrationName,
  statement as accountsMigrationStatement,
} from "../modules/accounts/infrastructure/postgres/migrations/0004_accounts.js";
import {
  name as materialsMigrationName,
  statement as materialsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0001_materials.js";
import {
  name as publishedMaterialsCursorIndexMigrationName,
  statement as publishedMaterialsCursorIndexMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0003_published_materials_cursor_index.js";
import {
  name as mutableMaterialsMigrationName,
  statement as mutableMaterialsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0005_mutable_materials.js";
import {
  name as removeMaterialAccessAuditMigrationName,
  statement as removeMaterialAccessAuditMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0007-remove-material-access-audit.js";
import {
  name as materialRelatedPinsMigrationName,
  statement as materialRelatedPinsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0010-material-related-pins.js";
import {
  name as membershipEntitlementsMigrationName,
  statement as membershipEntitlementsMigrationStatement,
} from "../modules/membership-entitlements/infrastructure/postgres/migrations/0006_membership-entitlements.js";
import {
  name as memberProfilesMigrationName,
  statement as memberProfilesMigrationStatement,
} from "../modules/member-profiles/infrastructure/postgres/migrations/0008_member_profiles.js";
import {
  name as removeMemberProfileReportsMigrationName,
  statement as removeMemberProfileReportsMigrationStatement,
} from "../modules/member-profiles/infrastructure/postgres/migrations/0012-remove-member-profile-reports.js";
import {
  name as profileAvatarsMigrationName,
  statement as profileAvatarsMigrationStatement,
} from "../modules/member-profiles/infrastructure/postgres/migrations/0015-profile-avatars.js";
import {
  name as publishedMaterialSearchMigrationName,
  statement as publishedMaterialSearchMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0009-published-material-search.js";
import {
  name as telegramMembershipMigrationName,
  statement as telegramMembershipMigrationStatement,
} from "../modules/telegram-membership/infrastructure/postgres/migrations/0011-telegram-membership.js";
import {
  name as materialAssetsMigrationName,
  statement as materialAssetsMigrationStatement,
} from "../modules/assets/infrastructure/postgres/migrations/0013-material-assets.js";
import {
  name as materialAssetReferenceStateMigrationName,
  statement as materialAssetReferenceStateMigrationStatement,
} from "../modules/assets/infrastructure/postgres/migrations/0014-material-asset-reference-state.js";
import {
  name as videosMigrationName,
  statement as videosMigrationStatement,
} from "../modules/videos/infrastructure/postgres/migrations/0016-videos.js";
import {
  name as primaryVideoMigrationName,
  statement as primaryVideoMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0017-primary-video.js";
import {
  name as durableVideoUploadAttemptsMigrationName,
  statement as durableVideoUploadAttemptsMigrationStatement,
} from "../modules/videos/infrastructure/postgres/migrations/0018-durable-video-upload-attempts.js";
import {
  name as contentCollectionsMigrationName,
  statement as contentCollectionsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0019-content-collections.js";
import {
  name as safeVideoDeletionMigrationName,
  statement as safeVideoDeletionMigrationStatement,
} from "../modules/videos/infrastructure/postgres/migrations/0020-safe-video-deletion.js";
import {
  name as workshopMaterialAccessMigrationName,
  statement as workshopMaterialAccessMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0021-workshop-material-access.js";
import {
  name as workshopVideoAccessMigrationName,
  statement as workshopVideoAccessMigrationStatement,
} from "../modules/videos/infrastructure/postgres/migrations/0022-workshop-video-access.js";
import {
  name as workshopFoundationMigrationName,
  statement as workshopFoundationMigrationStatement,
} from "../modules/workshop/infrastructure/postgres/migrations/0023-workshop-foundation.js";
import {
  name as workshopMembershipEntitlementProjectionMigrationName,
  statement as workshopMembershipEntitlementProjectionMigrationStatement,
} from "../modules/workshop/infrastructure/postgres/migrations/0024-membership-entitlement-projection.js";
import {
  name as contentCoversMigrationName,
  statement as contentCoversMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0025-content-covers.js";
import {
  name as videoDurationMigrationName,
  statement as videoDurationMigrationStatement,
} from "../modules/videos/infrastructure/postgres/migrations/0026-video-duration.js";
import {
  name as currentCollectionSearchMigrationName,
  statement as currentCollectionSearchMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0027-current-collection-search.js";

import {
  name as seriesStepGroupsMigrationName,
  statement as seriesStepGroupsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0028-series-step-groups.js";

export const platformMigrations = [
  {
    name: materialsMigrationName,
    statement: materialsMigrationStatement,
  },
  {
    name: identityPrincipalsMigrationName,
    statement: identityPrincipalsMigrationStatement,
  },
  {
    name: publishedMaterialsCursorIndexMigrationName,
    statement: publishedMaterialsCursorIndexMigrationStatement,
  },
  {
    name: accountsMigrationName,
    statement: accountsMigrationStatement,
  },
  {
    name: mutableMaterialsMigrationName,
    statement: mutableMaterialsMigrationStatement,
  },
  {
    name: membershipEntitlementsMigrationName,
    statement: membershipEntitlementsMigrationStatement,
  },
  {
    name: removeMaterialAccessAuditMigrationName,
    statement: removeMaterialAccessAuditMigrationStatement,
  },
  {
    name: memberProfilesMigrationName,
    statement: memberProfilesMigrationStatement,
  },
  {
    name: publishedMaterialSearchMigrationName,
    statement: publishedMaterialSearchMigrationStatement,
  },
  {
    name: materialRelatedPinsMigrationName,
    statement: materialRelatedPinsMigrationStatement,
  },
  {
    name: telegramMembershipMigrationName,
    statement: telegramMembershipMigrationStatement,
  },
  {
    name: removeMemberProfileReportsMigrationName,
    statement: removeMemberProfileReportsMigrationStatement,
  },
  {
    name: materialAssetsMigrationName,
    statement: materialAssetsMigrationStatement,
  },
  {
    name: materialAssetReferenceStateMigrationName,
    statement: materialAssetReferenceStateMigrationStatement,
  },
  {
    name: profileAvatarsMigrationName,
    statement: profileAvatarsMigrationStatement,
  },
  { name: videosMigrationName, statement: videosMigrationStatement },
  {
    name: primaryVideoMigrationName,
    statement: primaryVideoMigrationStatement,
  },
  {
    name: durableVideoUploadAttemptsMigrationName,
    statement: durableVideoUploadAttemptsMigrationStatement,
  },
  {
    name: contentCollectionsMigrationName,
    statement: contentCollectionsMigrationStatement,
  },
  {
    name: safeVideoDeletionMigrationName,
    statement: safeVideoDeletionMigrationStatement,
  },
  {
    name: workshopMaterialAccessMigrationName,
    statement: workshopMaterialAccessMigrationStatement,
  },
  {
    name: workshopVideoAccessMigrationName,
    statement: workshopVideoAccessMigrationStatement,
  },
  {
    name: workshopFoundationMigrationName,
    statement: workshopFoundationMigrationStatement,
  },
  {
    name: workshopMembershipEntitlementProjectionMigrationName,
    statement: workshopMembershipEntitlementProjectionMigrationStatement,
  },
  {
    name: contentCoversMigrationName,
    statement: contentCoversMigrationStatement,
  },
  {
    name: videoDurationMigrationName,
    statement: videoDurationMigrationStatement,
  },
  {
    name: currentCollectionSearchMigrationName,
    statement: currentCollectionSearchMigrationStatement,
  },
  {
    name: seriesStepGroupsMigrationName,
    statement: seriesStepGroupsMigrationStatement,
  },
  {
    name: telegramSignInMigrationName,
    statement: telegramSignInMigrationStatement,
  },
  {
    name: communicationsPermissionName,
    statement: communicationsPermissionStatement,
  },
  { name: trackingHitsName, statement: trackingHitsStatement },
  { name: readingActivityName, statement: readingActivityStatement },
  { name: materialVisitsName, statement: materialVisitsStatement },
  { name: contentCoverCleanupName, statement: contentCoverCleanupStatement },
  {
    name: domainMaterialFormatsName,
    statement: domainMaterialFormatsStatement,
  },
  {
    name: videoUploadRejectionsName,
    statement: videoUploadRejectionsStatement,
  },
  { name: platformAdminName, statement: platformAdminStatement },
  { name: accountAccessName, statement: accountAccessStatement },
  { name: telegramLinkRevisionsName, statement: telegramLinkRevisionsStatement },
  { name: billingPricingName, statement: billingPricingStatement },
  { name: billingContactName, statement: billingContactStatement },
  { name: billingTransportName, statement: billingTransportStatement },
  { name: materialsTransportName, statement: materialsTransportStatement },
  { name: notificationsTransportName, statement: notificationsTransportStatement },
  { name: notificationsName, statement: notificationsStatement },
  { name: homeMaterialPinName, statement: homeMaterialPinStatement },
  { name: homeSeriesPinName, statement: homeSeriesPinStatement },
  { name: scopedAccessName, statement: scopedAccessStatement },
  { name: subscriptionPaymentsName, statement: subscriptionPaymentsStatement },
  { name: subscriptionLifecycleName, statement: subscriptionLifecycleStatement },
  { name: guideArtifactsName, statement: guideArtifactsStatement },
  { name: guideChaptersName, statement: guideChaptersStatement },
  { name: bookmarksName, statement: bookmarksStatement },
  { name: communityEntitlementsName, statement: communityEntitlementsStatement },
  { name: billingManagePermissionName, statement: billingManagePermissionStatement },
  { name: billingOperationsName, statement: billingOperationsStatement },
  { name: billingNoticesName, statement: billingNoticesStatement },
  { name: guideIntroductionName, statement: guideIntroductionStatement },
  { name: offerForSaleName, statement: offerForSaleStatement },
  { name: oneTimePurchaseName, statement: oneTimePurchaseStatement },
  { name: materialAnnouncementsName, statement: materialAnnouncementsStatement },
  {
    name: lessonDifficultyAndOutcomesName,
    statement: lessonDifficultyAndOutcomesStatement,
  },
  { name: readerGuideModeName, statement: readerGuideModeStatement },
] as const;

export function migrateToLatest(
  connectionString: string,
): Promise<MigrationOutcome> {
  return runMigrationsToLatest(connectionString, platformMigrations);
}
