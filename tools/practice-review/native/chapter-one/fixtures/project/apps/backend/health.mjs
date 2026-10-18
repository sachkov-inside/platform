/** @param {{ready?: number}[]} rows */
export function healthResult(rows) {
  if (rows[0]?.ready !== 1) throw new Error("Database is not ready");
  return { status: "ready", database: "connected" };
}
