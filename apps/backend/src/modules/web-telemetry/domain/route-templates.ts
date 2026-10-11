// Page templates derived from apps/web/app; scripts/web-telemetry-routes.test.mjs checks drift.
export const telemetryRouteTemplates = [
  "/",
  "/account",
  "/account/access",
  "/account/notifications",
  "/account/purchases",
  "/account/subscription",
  "/authoring/access",
  "/authoring/billing",
  "/authoring/communications",
  "/authoring/communications/broadcasts",
  "/authoring/materials",
  "/authoring/materials/new",
  "/authoring/playlists",
  "/authoring/products",
  "/authoring/sales-funnel",
  "/authoring/submissions",
  "/authoring/topics",
  "/bookmarks",
  "/learning",
  "/legal",
  "/map",
  "/payment/checkout",
  "/payment/return",
  "/welcome",
  "/authoring/materials/[materialId]",
  "/authoring/materials/[materialId]/preview",
  "/authoring/playlists/[seriesId]",
  "/authoring/products/[seriesId]",
  "/legal/[slug]",
  "/legal/[slug]/[version]",
  "/materials/[slug]",
  "/products/[slug]",
  "/products/[slug]/buy",
  "/products/[slug]/programme",
  "/products/[slug]/tasks/[code]",
  "/topics/[slug]",
] as const;

export function normalizeTelemetryRoute(route: string): string {
  const path = route.split(/[?#]/u, 1)[0]?.replace(/\/$/u, "") ?? "";
  const segments = path.split("/");
  return (
    telemetryRouteTemplates.find((template) => {
      const parts = template.replace(/\/$/u, "").split("/");
      return (
        parts.length === segments.length &&
        parts.every(
          (part, index) =>
            part === segments[index] ||
            (part.startsWith("[") && (segments[index]?.length ?? 0) > 0),
        )
      );
    }) ?? "other"
  );
}
