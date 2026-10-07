/**
 * Persisted command digests keep their pre-#1065 vocabulary. This is a storage format, independent
 * of the live API and the temporary bot codec. Removing it requires migrating every old receipt.
 * Authored JSON is opaque; a domain rename never changes the content a command fingerprints.
 */
export function preProductCommand(value: unknown, field = ""): unknown {
  if (["body", "page", "definition", "reviewReport"].includes(field)) return value;
  if (Array.isArray(value)) {
    const entries = value.map((entry: unknown) => preProductCommand(entry, field));
    // The boundary schemas sorted these lists before storing both old and current receipts.
    if ((field === "capabilities" || field === "benefits") && entries.every((entry) => typeof entry === "string")) return entries.sort();
    return entries;
  }
  if (typeof value === "string") {
    if (field === "capability" || field === "capabilities" || field === "benefits") return value.replace(/^product:/u, "guide:");
    if (field === "operation") return value.replaceAll("product", "guide").replaceAll("Product", "Guide");
    if (field === "access" && value === "closed") return "membership";
    if (field === "kind" && value === "product") return "guide";
    if (field === "periodRef" || field === "sourceRef") return value.replace(/^([0-9a-f-]{36}):product:([0-9a-f-]{36})$/iu, "$1:guide:$2");
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]: [string, unknown]) => [previousKey(key), preProductCommand(child, key)]));
}

function previousKey(key: string): string {
  switch (key) {
    case "coverage": return "contentScope";
    case "wholePlatform": return "allGuides";
    case "productId": return "guideId";
    case "productIds": return "guideIds";
    case "productMode": return "guideMode";
    case "confirmedProductRemovals": return "confirmedGuideRemovals";
    default: return key;
  }
}
