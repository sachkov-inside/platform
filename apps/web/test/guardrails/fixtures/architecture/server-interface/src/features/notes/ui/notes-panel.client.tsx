import { readNotes } from "../api/read-notes.server";

/** Браузерный модуль импортирует серверный интерфейс. */
export function NotesPanel() {
  return <ul>{readNotes().length}</ul>;
}
