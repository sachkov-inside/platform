export const name = "0127_lesson_opened_parts";

/**
 * How many parts of a step-by-step lesson an Account has opened (#2122). Parts have no id: the
 * count follows the order of the lesson's step breaks and «after answer» exercises, and the Reader
 * clamps it to the parts the current version has. The count only grows; one row per Account and
 * Material. A guest keeps the same count in the browser.
 */
export const statement = `
create table reading_activity.lesson_opened_parts (
  account_id uuid not null,
  material_id uuid not null,
  opened_parts integer not null,
  updated_at timestamptz not null,
  constraint lesson_opened_parts_primary primary key (account_id, material_id),
  constraint lesson_opened_parts_bounds check (opened_parts between 1 and 1000)
);
`;
