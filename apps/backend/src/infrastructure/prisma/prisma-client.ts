import type { PrismaClient } from "./generated/client.js";

export type PlatformPrisma = PrismaClient;
export type MaterialsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "authoringIdempotency"
  | "contentCover"
  | "contentCoverRendition"
  | "materialNotificationOutbox"
  | "material"
  | "materialRelatedPin"
  | "homeSeriesPin"
  | "materialSearchDocument"
  | "materialTag"
  | "publishedMaterial"
  | "publishedMaterialGuideMembership"
  | "publishedMaterialTag"
  | "guide"
  | "guideArtifact"
  | "guideArtifactMaterialLink"
  | "guideArtifactPlacement"
  | "guideArtifactVersion"
  | "guideChapter"
  | "guideMembership"
  | "tag"
  | "topic"
  | "video"
  | "videoDeletionOperation"
>;
export type MaterialsPrismaTransaction = MaterialsPrisma;
export type MaterialsPrismaClient = MaterialsPrisma &
  TransactionClient<MaterialsPrismaTransaction>;

export type AssetsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "materialAsset"
  | "materialAssetVariant"
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
  "$queryRaw" | "account" | "accountAuditEvent" | "accountPermission" | "billingContact" | "billingContactChallenge" | "billingContactCommand" | "billingConsentEvidence"
>;
export type AccountsPrismaClient = AccountsPrisma & TransactionClient<AccountsPrisma>;

export type MemberProfilesPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "memberProfile"
  | "memberProfileAuditEvent"
  | "profileAvatar"
  | "profileAvatarRendition"
>;
export type MemberProfilesPrismaClient = MemberProfilesPrisma &
  TransactionClient<MemberProfilesPrisma>;

export type TelegramMembershipPrisma = Pick<
  PlatformPrisma,
  "$queryRaw" | "telegramLinkTransaction" | "telegramAccountLinkState" | "telegramAccountLinkHistory"
>;
export type TelegramMembershipPrismaClient = TelegramMembershipPrisma &
  TransactionClient<TelegramMembershipPrisma>;

export interface TransactionClient<Transaction> {
  $transaction<Result>(
    operation: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result>;
}

export type CommunicationsPrisma = Pick<PlatformPrisma, "communicationTrackingHit">;

export type ReadingActivityPrisma = Pick<PlatformPrisma,
  "$executeRaw" | "$queryRaw" | "readingMaterialState" | "readingEvent" | "readingCommand" | "readingMaterialVisit"
>;
export type ReadingActivityPrismaClient = ReadingActivityPrisma & TransactionClient<ReadingActivityPrisma>;

export type BookmarksPrisma = Pick<PlatformPrisma,
  "$executeRaw" | "$queryRaw" | "bookmarkedMaterial"
>;
export type BookmarksPrismaClient = BookmarksPrisma & TransactionClient<BookmarksPrisma>;

export type BillingPrisma = Pick<PlatformPrisma,
  "$executeRaw" | "billingNotificationOutbox" | "billingOffer" | "billingPaymentOption" | "billingPromotion" |
  "billingPricingCommand" | "billingPriceQuote" | "billingPromoReservation" | "billingPurchase" | "billingPurchaseCommand" | "billingPaymentEvent" | "billingFulfillment" |
  "billingSubscription" | "billingSubscriptionEvent" | "billingSubscriptionCommand" | "billingChangeQuote" | "billingPaymentMethodFlow" |
  "billingNotice" | "billingNoticeRevision"
>;
export type BillingPrismaClient = BillingPrisma & TransactionClient<BillingPrisma>;

export type NotificationsPrisma = Pick<PlatformPrisma,
  "$executeRaw" | "notificationPreference" | "notificationPreferenceRevision" | "notification" | "notificationDelivery" | "notificationCommand" | "notificationAuthorization" | "notificationResult" | "notificationEmailInbox" | "notificationEmailEffect" | "notificationEmailAttempt" | "notificationRecoveryAudit" | "notificationOutbox" | "notificationInbox" | "notificationQuarantine"
>;
export type NotificationsPrismaClient = NotificationsPrisma & TransactionClient<NotificationsPrisma>;
