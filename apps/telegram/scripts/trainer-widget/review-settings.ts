/** The endpoint comes only from the new review Compose project's published port. */
export function reviewDatabaseUrl(
  published: string,
  databaseName: string,
): string {
  if (!/^trainer_review_[0-9a-f]{8}$/.test(databaseName))
    throw new Error("Review database must have its own generated name");
  const address = /^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(published.trim());
  if (!address || Number(address[1]) > 65_535)
    throw new Error("Review PostgreSQL must publish a loopback port");
  return `postgresql://inside:inside@127.0.0.1:${address[1]}/${databaseName}`;
}

/** A remote website must not drive the local review person's progress. */
export function permitsReviewPost(
  origin: string | undefined,
  contentType: string | undefined,
  expectedOrigin: string,
): boolean {
  return origin === expectedOrigin && contentType === "application/json";
}
