import { handleNoteCreation } from "../../../notes-route.server";

export function POST(request: Request): Promise<Response> {
  return handleNoteCreation(request);
}
