/** Fixed queues owned by Platform workers; diagnostic callers cannot select arbitrary queues. */
export const jobQueues = {
  materialAssets: "material-assets.cleanup",
  profileAvatars: "profile-avatars.cleanup",
  videoDeletions: "videos.deletions",
  telemetryRetention: "web-telemetry.retention",
  paymentRecovery: "billing.payment-recovery",
  subscriptionRenewal: "billing.subscription-renewal",
  subscriptionNotices: "billing.subscription-notices",
  tributeReconciliation: "tribute.source-reconciliation",
  communityDelivery: "community.entitlement-delivery",
} as const;
