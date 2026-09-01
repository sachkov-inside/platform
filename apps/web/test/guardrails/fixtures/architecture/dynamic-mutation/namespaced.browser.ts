import * as sameOriginMutation from "@/shared/api/same-origin-mutation";

export function deleteMaterial(method: "PATCH" | "DELETE") {
  return sameOriginMutation.requestSameOriginMutation(
    "/api/authoring/materials",
    method,
    new FormData(),
  );
}
