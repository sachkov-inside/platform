import { problemException } from "../../../../infrastructure/http/problem-details.js";
export function throwPersonalHomeError(code: "series_not_found" | "invalid_request" | "command_conflict" | "access_changed" | "access_denied" | "dependency_unavailable"): never {
  const status = code === "series_not_found" ? 404 : code === "invalid_request" ? 400 : code === "access_denied" ? 403 : code === "dependency_unavailable" ? 503 : 409;
  throw problemException(status, code, "Personal home request failed");
}
