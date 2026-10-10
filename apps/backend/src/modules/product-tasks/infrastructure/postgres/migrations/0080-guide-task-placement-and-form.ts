export const name = "0080_guide_task_placement_and_form";

// Guide Task page (#947). A task may stand right after one Material of its chapter in the
// programme; the Material is named by its authoring source, like related Materials, and a task
// without it stands at the start of its chapter. A submission through the page form carries the
// learner's own report as plain text instead of an agent's structured report.
export const statement = `
ALTER TABLE guide_tasks.tasks
  ADD COLUMN after_material_source_id text
    CHECK (char_length(after_material_source_id) BETWEEN 1 AND 200);

ALTER TABLE guide_tasks.submissions
  ADD COLUMN report_text text
    CHECK (char_length(report_text) BETWEEN 1 AND 20000),
  ADD CONSTRAINT submissions_report_text_from_form
    CHECK (source = 'form' OR report_text IS NULL);
`;
