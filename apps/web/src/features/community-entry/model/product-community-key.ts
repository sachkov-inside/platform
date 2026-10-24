/** Account and Product own the client read identity; server hydration uses the same key. */
export const productCommunityQueryKey = (
  accountId: string | null,
  productId: string,
) => ["account", "product-community", accountId, productId] as const;
