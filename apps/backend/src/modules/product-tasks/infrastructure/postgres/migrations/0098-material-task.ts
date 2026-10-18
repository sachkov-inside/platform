export const name = "0098_material_task";
export const statement = `
ALTER TABLE product_tasks.tasks
  ADD COLUMN programme_visibility text NOT NULL DEFAULT 'standalone',
  ADD COLUMN embedded_material_id uuid,
  ADD CONSTRAINT tasks_programme_visibility CHECK (programme_visibility IN ('standalone', 'embedded', 'legacy')),
  ADD CONSTRAINT tasks_embedded_binding CHECK ((programme_visibility = 'embedded') = (embedded_material_id IS NOT NULL)),
  ADD CONSTRAINT tasks_embedded_material_unique UNIQUE (embedded_material_id);
`;
