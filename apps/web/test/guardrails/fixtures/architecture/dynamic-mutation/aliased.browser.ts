import {
  requestSameOriginMutation as mutateSameOrigin,
} from "@/shared/api/same-origin-mutation";

export function saveMaterial(route: string) {
  return mutateSameOrigin(route, "PUT", new FormData());
}
