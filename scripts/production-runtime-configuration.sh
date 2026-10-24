#!/usr/bin/env bash
# Private disposable runtime configuration, shared by smoke and bounded resource fixture.
# Caller owns directories, source identity and synthetic values; this file has no startup effects.
write_disposable_runtime_configuration() {
  cat >"$runtime_config_dir/runtime.env" <<EOF
PLATFORM_RELEASE_VERSION=$release_version
PLATFORM_SOURCE_SHA=$source_sha
EOF
  cat >"$runtime_config_dir/migrations.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
EOF
  cat >"$runtime_config_dir/api.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
API_HOST=0.0.0.0
API_PORT=3001
LOGTO_ISSUER=https://identity.production-smoke.invalid/oidc
LOGTO_AUDIENCE=https://api.production-smoke.invalid
LOGTO_JWKS_URL=https://identity.production-smoke.invalid/oidc/jwks
IDENTITY_EMAIL_FINGERPRINT_KEY=inside-production-smoke-email-fingerprint-key
PUBLIC_SITE_ORIGIN=https://inside.production-smoke.invalid
TELEGRAM_BOT_START_URL=https://t.me/inside_production_smoke_bot
TELEGRAM_LINKING_ENDPOINT=https://telegram.production-smoke.invalid/integrations/platform/v1/identity-links
TELEGRAM_LINKING_SECRET=inside-production-smoke-linking-secret
TELEGRAM_EVIDENCE_INGRESS_SECRET=inside-production-smoke-evidence-secret
TELEGRAM_LINK_LIFETIME_SECONDS=300
OBJECT_STORAGE_ENDPOINT=https://storage.production-smoke.invalid
OBJECT_STORAGE_REGION=ru-central1
OBJECT_STORAGE_ACCESS_KEY_ID=inside-production-smoke-storage-access-key
OBJECT_STORAGE_SECRET_ACCESS_KEY=inside-production-smoke-storage-secret-key
OBJECT_STORAGE_PUBLIC_BUCKET=inside-production-smoke-public
OBJECT_STORAGE_PROTECTED_BUCKET=inside-production-smoke-protected
OBJECT_STORAGE_QUARANTINE_BUCKET=inside-production-smoke-quarantine
OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS=60
MATERIAL_ASSET_ORPHAN_GRACE_SECONDS=86400
PROFILE_AVATAR_ORPHAN_GRACE_SECONDS=86400
KINESCOPE_PROVIDER_MODE=real
KINESCOPE_API_BASE_URL=https://api.kinescope.io
KINESCOPE_UPLOADER_BASE_URL=https://uploader.kinescope.io
KINESCOPE_API_TOKEN=inside-production-smoke-kinescope-token
KINESCOPE_PUBLIC_PROJECT_ID=inside-production-smoke-public-project
KINESCOPE_MEMBERSHIP_PROJECT_ID=inside-production-smoke-membership-project
KINESCOPE_CALLBACK_USERNAME=inside-production-smoke-callback
KINESCOPE_CALLBACK_PASSWORD=inside-production-smoke-callback-password
KINESCOPE_WEBHOOK_USERNAME=inside-production-smoke-webhook
KINESCOPE_WEBHOOK_PASSWORD=inside-production-smoke-webhook-password
KINESCOPE_PLAYBACK_JWT_SECRET=inside-production-smoke-playback-signing-secret
KINESCOPE_PLAYBACK_JWT_TTL_SECONDS=60
TBANK_CONFIG_JSON={"environment":"production","terminalKey":"INSIDEPRODUCTIONSMOKE","password":"inside-production-smoke-terminal-password","bindingEncryptionKey":"$smoke_encryption_key","recurringCardConfirmed":false,"cardOnlyHostedConfirmed":false,"minimumKopecks":100,"maximumKopecks":30000000,"returnUrl":"https://sachkov.dev/payment/return","notificationUrl":"https://inside.sachkov.dev/billing/tbank/notification","receipt":{"taxation":"usn_income","tax":"none"}}
BILLING_CONTACT_ENCRYPTION_KEY=$smoke_encryption_key
BILLING_CONTACT_SMTP_HOST=smtp.production-smoke.invalid
BILLING_CONTACT_SMTP_PORT=587
BILLING_CONTACT_FROM=no-reply@inside.production-smoke.invalid
TRIBUTE_API_KEY=inside-production-smoke-tribute-api-key
TRIBUTE_SIGNATURE_ENCODING=hex
NOTIFICATIONS_PLATFORM_ORIGIN=https://inside.production-smoke.invalid
NOTIFICATIONS_TELEGRAM_SECRET=inside-production-smoke-notification-dispatch-secret
TELEGRAM_ACTIVATION_INGRESS_SECRET=inside-production-smoke-activation-secret
TELEGRAM_COMMUNITY_CONTRACT_VERSION=inside.community-entitlement.v2
TELEGRAM_COMMUNITY_ENTITLEMENT_ENDPOINT=https://telegram.production-smoke.invalid/integrations/platform/v1/community-entitlements
TELEGRAM_COMMUNITY_ENTITLEMENT_SECRET=inside-production-smoke-community-provider-secret
TELEGRAM_COMMUNITY_DISPATCH_SECRET=inside-production-smoke-community-dispatch-secret
EOF
  cat >"$runtime_config_dir/mcp.env" <<EOF
$(sed '/^API_HOST=/d; /^API_PORT=/d; /^TELEGRAM_/d; /^TRIBUTE_/d; /^NOTIFICATIONS_/d' "$runtime_config_dir/api.env")
MCP_HOST=0.0.0.0
MCP_PORT=3002
MCP_SERVER_URL=https://inside.sachkov.dev/mcp
EOF
  cat >"$runtime_config_dir/material-assets-worker.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
OBJECT_STORAGE_ENDPOINT=https://storage.production-smoke.invalid
OBJECT_STORAGE_REGION=ru-central1
OBJECT_STORAGE_ACCESS_KEY_ID=inside-production-smoke-storage-access-key
OBJECT_STORAGE_SECRET_ACCESS_KEY=inside-production-smoke-storage-secret-key
OBJECT_STORAGE_PUBLIC_BUCKET=inside-production-smoke-public
OBJECT_STORAGE_PROTECTED_BUCKET=inside-production-smoke-protected
OBJECT_STORAGE_QUARANTINE_BUCKET=inside-production-smoke-quarantine
OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS=60
MATERIAL_ASSET_ORPHAN_GRACE_SECONDS=86400
PROFILE_AVATAR_ORPHAN_GRACE_SECONDS=86400
EOF
  cp "$runtime_config_dir/material-assets-worker.env" "$runtime_config_dir/profile-avatars-worker.env"
  cat >"$runtime_config_dir/video-deletions-worker.env" <<'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside
KINESCOPE_PROVIDER_MODE=real
KINESCOPE_API_BASE_URL=https://api.kinescope.io
KINESCOPE_UPLOADER_BASE_URL=https://uploader.kinescope.io
KINESCOPE_API_TOKEN=inside-production-smoke-kinescope-token
KINESCOPE_PUBLIC_PROJECT_ID=inside-production-smoke-public-project
KINESCOPE_MEMBERSHIP_PROJECT_ID=inside-production-smoke-membership-project
KINESCOPE_CALLBACK_USERNAME=inside-production-smoke-callback
KINESCOPE_CALLBACK_PASSWORD=inside-production-smoke-callback-password
KINESCOPE_WEBHOOK_USERNAME=inside-production-smoke-webhook
KINESCOPE_WEBHOOK_PASSWORD=inside-production-smoke-webhook-password
KINESCOPE_PLAYBACK_JWT_SECRET=inside-production-smoke-playback-signing-secret
KINESCOPE_PLAYBACK_JWT_TTL_SECONDS=60
EOF
  {
    printf 'NODE_ENV=production\nDATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside\n'
    grep -E '^(TBANK_CONFIG_JSON|BILLING_CONTACT_[A-Z_]+|TELEGRAM_COMMUNITY_[A-Z_]+)=' "$runtime_config_dir/api.env"
  } >"$runtime_config_dir/billing-worker.env"
  {
    printf 'NODE_ENV=production\nDATABASE_URL=postgresql://platform:platform-production-smoke-password@postgres:5432/inside\n'
    printf 'NOTIFICATIONS_BROKER_URLS={"billing":"%s","materials":"%s","notifications":"%s","email":"%s"}\n' \
      "$(broker_url platform-billing)" "$(broker_url platform-materials)" "$(broker_url platform-notifications)" "$(broker_url platform-email)"
    printf 'NOTIFICATIONS_BROKER_CA_FILE=/etc/inside/broker-ca.pem\nNOTIFICATIONS_PREFETCH=4\nNOTIFICATIONS_QUARANTINE_CAPACITY=1000\n'
    grep -E '^(NOTIFICATIONS_PLATFORM_ORIGIN|NOTIFICATIONS_TELEGRAM_SECRET|TBANK_CONFIG_JSON|BILLING_CONTACT_[A-Z_]+)=' "$runtime_config_dir/api.env"
  } >"$runtime_config_dir/notifications-worker.env"
  cat >"$runtime_config_dir/web.env" <<EOF
NODE_ENV=production
BACKEND_BASE_URL=http://api:3001
LOGTO_ENDPOINT=https://identity.production-smoke.invalid
LOGTO_AUDIENCE=https://api.production-smoke.invalid
LOGTO_APP_ID=inside-production-smoke
LOGTO_APP_SECRET=inside-production-smoke-app-secret
LOGTO_COOKIE_SECRET=inside-production-smoke-cookie-secret-key
WEB_BASE_URL=https://sachkov.dev
LEARNER_MCP_URL=https://inside.sachkov.dev/mcp/learning
EOF
}
