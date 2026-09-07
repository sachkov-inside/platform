import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { personalHomeResultSchema } from "../model/personal-home-contract";
export async function loadPersonalHome() {
  const result = await requestSameOriginMutation("/api/personal-home", "POST", new FormData());
  if (!result.ok) return { kind: result.status === 401 ? "hidden" : "unavailable" } as const;
  const parsed = personalHomeResultSchema.safeParse(result.body);
  return parsed.success ? parsed.data : { kind: "unavailable" } as const;
}
