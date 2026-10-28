// @ts-check
// These roles share the workspace image. Replace them together to avoid mixed source versions.
export const standApplicationServices = [
  "api",
  "mcp",
  "material-assets-worker",
  "profile-avatars-worker",
  "video-deletions-worker",
  "billing-worker",
  "notifications-worker",
  "bank-double",
  "web",
  "local-accounts",
];
// Long-running services outside the shared image. Readiness requires them; an upgrade lets
// Compose replace those whose configuration or image changed, with their volumes attached.
export const standInfrastructureServices = [
  "postgres",
  "object-storage",
  "rabbitmq",
  "logto",
  "logto-postgres",
  "mailpit",
];
// Database clusters an upgrade dumps before it migrates anything.
export const standDatabaseServices = ["postgres", "logto-postgres"];
