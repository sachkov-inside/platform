import { z } from "zod";

export const analyticsConsentKey = "inside.analytics-choice.v1";
export const analyticsChoiceSchema = z.strictObject({
  revision: z.string().min(1).max(16),
  choice: z.enum(["necessary", "allowed"]),
});
export const analyticsConfigSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({
    enabled: z.literal(true),
    revision: z.string().min(1).max(16),
  }),
]);
export const analyticsEventSchema = z.enum([
  "product_view",
  "material_view",
  "access_restricted",
  "checkout_started",
]);
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
// Fixed labels replace URLs entirely. Even a personal slug cannot enter analytics storage.
export const analyticsPaths: Record<AnalyticsEvent, string> = {
  product_view: "/products/:slug",
  material_view: "/materials/:slug",
  access_restricted: "/materials/:slug/locked",
  checkout_started: "/products/:slug/purchase",
};
export const analyticsSourceSchema = z.enum([
  "direct",
  "inside",
  "telegram",
  "newsletter",
  "unknown",
]);
export const analyticsCaptureSchema = z.strictObject({
  revision: z.string().min(1).max(16),
  event: analyticsEventSchema,
  campaign: analyticsSourceSchema,
  referrer: analyticsSourceSchema,
});

/** Discard every raw URL, query, fragment and arbitrary hostname before the browser sends. */
export function analyticsSources(href: string, referrer: string) {
  const url = URL.parse(href);
  const campaign = analyticsSourceSchema.safeParse(
    url?.searchParams.get("utm_source"),
  );
  const previous = URL.parse(referrer);
  return {
    campaign: campaign.success ? campaign.data : ("unknown" as const),
    referrer:
      previous === null
        ? ("direct" as const)
        : previous.origin === url?.origin
          ? ("inside" as const)
          : previous.hostname === "t.me"
            ? ("telegram" as const)
            : ("unknown" as const),
  };
}
