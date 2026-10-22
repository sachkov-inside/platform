import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

export function createNote(text: string) {
  const form = new FormData();
  form.set("text", text);
  return requestSameOriginMutation("/api/notes", "POST", form);
}
