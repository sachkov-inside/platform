import { createHash } from "node:crypto";

/** Отпечаток одноразового `state` подключения; сам `state` не хранится. */
export function connectionStateDigest(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
