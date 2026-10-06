import "server-only";

export interface Note {
  readonly title: string;
}

export function readNotes(): readonly Note[] {
  return [];
}
