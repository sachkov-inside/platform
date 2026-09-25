export async function loadExample(): Promise<unknown> {
  const { lazyExample } = await import("../modules/example/index.js");
  return lazyExample;
}
