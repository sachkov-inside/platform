import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

export function mutateMaterial(route: string, method: "PATCH" | "DELETE") {
  return requestSameOriginMutation(route, method, new FormData());
}
