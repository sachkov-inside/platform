/** HTTP responses remain unknown until the consumer's real contract validates them. */
export function learningHttpProduct(role: "holder" | "learner"): unknown;
export function learningHttpReader(
  slug: string,
  role: "holder" | "learner",
): unknown;
export function learningHttpArtifacts(): unknown;
