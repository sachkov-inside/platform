import "server-only";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { getPersonalHome } from "./get-personal-home.server";
export function handlePersonalHome(request: Request) {
  return handleAuthenticatedMutation(request, async (_form, token) => getPersonalHome(token));
}
