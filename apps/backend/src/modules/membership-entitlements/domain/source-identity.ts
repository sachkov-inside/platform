import { createHash } from "node:crypto";
export function sourceIdentityRef(origin: "course" | "tribute", policy: string, identity: string) {
  return createHash("sha256").update(JSON.stringify([origin, policy, identity])).digest("hex");
}
export function courseSourceRef(policy: string, identity: string) {
  return sourceIdentityRef("course", policy, identity);
}
