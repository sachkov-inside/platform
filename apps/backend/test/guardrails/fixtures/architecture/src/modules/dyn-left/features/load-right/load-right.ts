export async function loadRight(): Promise<unknown> {
  const { rightValue } = await import("../../../dyn-right/index.js");
  return rightValue;
}
