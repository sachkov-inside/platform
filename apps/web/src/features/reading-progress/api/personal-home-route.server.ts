import "server-only";
import { handleMutationOperation } from "@/shared/auth/index.server";
import { getPersonalHome } from "./get-personal-home.server";
import { loadPersonalHomeOperation } from "./reading-progress.operation";
export function handlePersonalHome(request: Request) {
  return handleMutationOperation(request, loadPersonalHomeOperation, {
    invalidInput: () => ({ kind: "unavailable" }) as const,
    execute: (_input, token) => getPersonalHome(token),
  });
}
