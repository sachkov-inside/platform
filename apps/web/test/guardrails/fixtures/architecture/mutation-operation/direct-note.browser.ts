export function createNote(text: string) {
  return fetch("/api/notes", {
    body: JSON.stringify({ text }),
    method: "POST",
  });
}
