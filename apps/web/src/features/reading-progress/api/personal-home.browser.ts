import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { personalHomeResultSchema } from "../model/personal-home-contract";
export async function loadPersonalHome() {
  const result = await requestSameOriginMutation("/api/personal-home", "POST", new FormData());
  if (!result.ok) {
    if (result.status === 401) return { kind: "hidden" } as const;
    throw new Error("Personal Home is unavailable");
  }
  const parsed = personalHomeResultSchema.safeParse(result.body);
  if (!parsed.success || parsed.data.kind === "unavailable") throw new Error("Personal Home is unavailable");
  return parsed.data;
}
