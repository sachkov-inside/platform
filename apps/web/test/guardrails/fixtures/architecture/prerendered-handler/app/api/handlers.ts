export function handleRead(): Response {
  return Response.json({});
}

/** Одноимённая с `connection` из Next.js, но запроса не касается. */
export async function connection(): Promise<void> {
  await Promise.resolve();
}
