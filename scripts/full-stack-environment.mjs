// @ts-check
/**
 * Environment shared by host runs of the application against local infrastructure: the full-stack
 * smoke and the light stand instance.
 *
 * The seed sells the guide, and API and billing refuse to start a sale without a bank and a
 * receipt mail address. These runs buy nothing, so the local stand outline is enough: the bank
 * double at an unreachable address and captured mail.
 */
export const fullStackOfflineServices = Object.freeze({
  TBANK_PROVIDER_MODE: "test",
  TBANK_TEST_API_BASE_URL: "http://127.0.0.1:9/v2",
  BILLING_CONTACT_ENCRYPTION_KEY:
    "aW5zaWRlLWxvY2FsLWJpbGxpbmctY29udGFjdC1rZXk=",
  BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
  BILLING_CONTACT_SMTP_PORT: "9",
  BILLING_CONTACT_FROM: "no-reply@inside.localhost",
  BILLING_CONTACT_SMTP_LOCAL_CAPTURE: "true",
});

/** The release identity of a host build: `apps/web/release-identity.json` and the processes. */
export const fullStackRelease = Object.freeze({
  release: "v1",
  sourceSha: "1".repeat(40),
});

export const fullStackReleaseEnvironment = Object.freeze({
  PLATFORM_RELEASE_VERSION: fullStackRelease.release,
  PLATFORM_SOURCE_SHA: fullStackRelease.sourceSha,
});
