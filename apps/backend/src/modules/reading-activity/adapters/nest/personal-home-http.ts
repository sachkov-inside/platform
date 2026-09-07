import { HttpException } from "@nestjs/common";
export function throwPersonalHomeError(code: "invalid_request" | "command_conflict" | "access_changed" | "access_denied" | "dependency_unavailable"): never {
  const status = code === "invalid_request" ? 400 : code === "access_denied" ? 403 : code === "dependency_unavailable" ? 503 : 409;
  throw new HttpException({ type: "about:blank", title: "Personal home request failed", status, code }, status);
}
