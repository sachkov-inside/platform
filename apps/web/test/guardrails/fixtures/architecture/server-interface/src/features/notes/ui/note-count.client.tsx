import { type Note } from "../api/read-notes.server";

/** При `verbatimModuleSyntax` такой импорт остаётся `import {}` и загружает серверный модуль. */
export function NoteCount({ notes }: { readonly notes: readonly Note[] }) {
  return <span>{notes.length}</span>;
}
