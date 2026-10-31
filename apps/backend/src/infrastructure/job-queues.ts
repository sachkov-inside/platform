/** Fixed queues owned by Platform workers; diagnostic callers cannot select arbitrary queues. */
export const jobQueues = {
  activityRetention: "membership-activity.retention",
  materialAssets: "material-assets.cleanup",
  profileAvatars: "profile-avatars.cleanup",
  videoDeletions: "videos.deletions",
  telemetryRetention: "web-telemetry.retention",
  paymentRecovery: "billing.payment-recovery",
  communityDelivery: "community.entitlement-delivery",
} as const;
