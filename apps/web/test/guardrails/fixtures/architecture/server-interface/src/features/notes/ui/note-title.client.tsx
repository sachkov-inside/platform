import type { Note } from "../api/read-notes.server";

/** Тип стирается при сборке, поэтому серверный модуль в браузер не попадает. */
export function NoteTitle({ note }: { readonly note: Note }) {
  return <h2>{note.title}</h2>;
}
