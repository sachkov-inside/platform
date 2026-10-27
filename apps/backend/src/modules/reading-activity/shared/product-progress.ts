/**
 * The one definition of Product progress. The total is the published programme the Products
 * composition returns, each Material once; a Material counts as read while its reading state is
 * marked read. Catalogue attachments and unpublished occurrences are outside the composition.
 */
export function readProgrammeMaterials(programme: readonly string[]) {
  return { materialId: { in: [...programme] }, isRead: true };
}
