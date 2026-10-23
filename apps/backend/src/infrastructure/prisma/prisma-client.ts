import type { PrismaClient } from "./generated/client.js";

export type PlatformPrisma = PrismaClient;
export type MaterialsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "authoringIdempotency"
  | "practiceDefinition"
  | "practiceImportReceipt"
  | "materialAnnouncement"
  | "materialAnnouncementRevision"
  | "materialNotificationOutbox"
  | "material"
  | "materialRelatedPin"
  | "materialSearchDocument"
  | "materialTag"
  | "publishedMaterial"
  | "publishedMaterialTag"
  | "tag"
  | "topic"
>;
export type MaterialsPrismaTransaction = MaterialsPrisma;
export type MaterialsPrismaClient = MaterialsPrisma &
  TransactionClient<MaterialsPrismaTransaction>;

export type AssetsPrisma = Pick<
  PlatformPrisma,
  "$executeRaw" | "$queryRaw" | "materialAsset" | "materialAssetVariant"
>;
export type AssetsPrismaTransaction = AssetsPrisma;
export type AssetsPrismaClient = AssetsPrisma &
  TransactionClient<AssetsPrismaTransaction>;

export type VideosPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "video"
  | "videoDeletionOperation"
  | "videoPlaybackProgress"
  | "videoUploadAttempt"
  | "videoWebhookInbox"
>;
export type VideosPrismaClient = VideosPrisma & TransactionClient<VideosPrisma>;

export type AccountsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "account"
  | "accountAuditEvent"
  | "accountPermission"
  | "billingContact"
  | "billingContactChallenge"
  | "billingContactCommand"
  | "legalAcceptance"
>;
export type AccountsPrismaClient = AccountsPrisma &
  TransactionClient<AccountsPrisma>;

export type AccountProfilesPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "memberProfile"
  | "memberProfileAuditEvent"
  | "profileAvatar"
  | "profileAvatarRendition"
>;
export type AccountProfilesPrismaClient = AccountProfilesPrisma &
  TransactionClient<AccountProfilesPrisma>;

export type TelegramMembershipPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "telegramLinkTransaction"
  | "telegramAccountLinkState"
  | "telegramAccountLinkHistory"
  | "productCommunity"
  | "telegramCommunityDesiredState"
  | "telegramCommunityOperation"
  | "telegramCommunityAuthorization"
  | "telegramCommunityProjectionCursor"
  | "telegramCommunityProjectionRetry"
>;
export type TelegramMembershipPrismaClient = TelegramMembershipPrisma &
  TransactionClient<TelegramMembershipPrisma>;

export type ProductTasksPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "productTask"
  | "productTaskVersion"
  | "productTaskImportReceipt"
  | "productTaskSubmission"
  | "productTaskReviewProgress"
  | "productTaskAuthorFeedback"
>;
export type ProductTasksPrismaClient = ProductTasksPrisma &
  TransactionClient<ProductTasksPrisma>;

export interface TransactionClient<Transaction> {
  $transaction<Result>(
    operation: (transaction: Transaction) => Promise<Result>,
    options?: { readonly timeout: number },
  ): Promise<Result>;
}

export type CommunicationsPrisma = Pick<
  PlatformPrisma,
  "communicationTrackingHit"
>;

export type ReadingActivityPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "readingMaterialState"
  | "readingEvent"
  | "readingCommand"
  | "readingMaterialVisit"
  | "productLearningStarted"
  | "readerPreferences"
>;
export type ReadingActivityPrismaClient = ReadingActivityPrisma &
  TransactionClient<ReadingActivityPrisma>;

export type BookmarksPrisma = Pick<
  PlatformPrisma,
  "$executeRaw" | "$queryRaw" | "bookmarkedMaterial"
>;
export type BookmarksPrismaClient = BookmarksPrisma &
  TransactionClient<BookmarksPrisma>;

export type SalesFunnelPrisma = Pick<
  PlatformPrisma,
  | "$queryRaw"
  | "$executeRaw"
  | "salesFunnelBotEvent"
  | "productWaitlistIntake"
  | "productWaitlistMembership"
  | "productWaitlistEvent"
  | "productWaitlistOperation"
  | "productWaitlistConfirmation"
>;
export type SalesFunnelPrismaClient = SalesFunnelPrisma &
  TransactionClient<SalesFunnelPrisma>;

export type BillingPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "billingNotificationOutbox"
  | "billingOffer"
  | "billingPaymentOption"
  | "billingPromotion"
  | "billingPricingCommand"
  | "billingPaymentLink"
  | "billingPriceQuote"
  | "billingPromoReservation"
  | "billingPurchase"
  | "billingPurchaseCommand"
  | "billingPaymentEvent"
  | "billingFulfillment"
  | "billingSubscription"
  | "billingSubscriptionEvent"
  | "billingSubscriptionCommand"
  | "billingChangeQuote"
  | "billingPaymentMethodFlow"
  | "billingOwnerCommand"
  | "billingOwnerCommandKey"
  | "billingRefundDecision"
  | "billingRefund"
  | "billingNotice"
  | "billingNoticeRevision"
  | "billingSurveyRespondent"
  | "billingProductCohort"
>;
export type BillingPrismaClient = BillingPrisma &
  TransactionClient<BillingPrisma>;

export type NotificationsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "notificationPreference"
  | "notificationPreferenceRevision"
  | "notification"
  | "notificationDelivery"
  | "notificationCommand"
  | "notificationAuthorization"
  | "notificationResult"
  | "notificationEmailInbox"
  | "notificationEmailEffect"
  | "notificationEmailAttempt"
  | "notificationRecoveryAudit"
  | "notificationOutbox"
  | "notificationInbox"
  | "notificationQuarantine"
>;
export type NotificationsPrismaClient = NotificationsPrisma &
  TransactionClient<NotificationsPrisma>;

export type WebTelemetryPrisma = Pick<
  PlatformPrisma,
  "$executeRaw" | "$queryRaw"
>;

export type ProductsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "product"
  | "productArtifact"
  | "productArtifactMaterialLink"
  | "productArtifactPlacement"
  | "productArtifactVersion"
  | "productChapter"
  | "productChapterSupplementaryMaterial"
  | "productMaterialRemoval"
  | "productMembership"
  | "productProgrammePlacement"
  | "publishedMaterialProductMembership"
  | "homeSeriesPin"
>;
export type ProductsPrismaTransaction = ProductsPrisma;
export type ProductsPrismaClient = ProductsPrisma &
  TransactionClient<ProductsPrisma>;
export type ContentCoversPrisma = Pick<
  PlatformPrisma,
  "$executeRaw" | "$queryRaw" | "contentCover" | "contentCoverRendition"
>;
export type ContentCoversPrismaClient = ContentCoversPrisma &
  TransactionClient<ContentCoversPrisma>;
