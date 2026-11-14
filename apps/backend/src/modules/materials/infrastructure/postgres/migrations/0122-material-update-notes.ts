export const name = "0122_material_update_notes";

/**
 * The latest substantial update an author noted on a Material and its «Что изменилось» text
 * (#2125). `noted_at` is when the update with this `note_id` first arrived; a later apply of the
 * same `note_id` may correct the text but keeps the moment.
 */
export const statement = `
CREATE TABLE materials.material_update_notes (
  material_id uuid NOT NULL,
  note_id text NOT NULL,
  what_changed text NOT NULL,
  noted_at timestamptz NOT NULL,
  CONSTRAINT material_update_notes_primary PRIMARY KEY (material_id),
  CONSTRAINT material_update_notes_material_fk FOREIGN KEY (material_id)
    REFERENCES materials.materials (id) ON DELETE CASCADE,
  CONSTRAINT material_update_notes_note_id_valid CHECK (
    note_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(note_id) <= 64
  ),
  CONSTRAINT material_update_notes_what_changed_valid CHECK (
    what_changed = btrim(what_changed) AND char_length(what_changed) BETWEEN 1 AND 500
  )
);
`;
