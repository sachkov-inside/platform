export const name = "0061_lesson_difficulty_and_outcomes";

export const statement = `
alter table materials.materials
  add column difficulty text,
  add column outcomes jsonb not null default '[]'::jsonb;

alter table materials.materials
  add constraint materials_difficulty_valid check (
    difficulty is null or difficulty in ('basic', 'intermediate', 'advanced')
  ),
  add constraint materials_outcomes_valid check (
    jsonb_typeof(outcomes) = 'array' and jsonb_array_length(outcomes) <= 4
  );

alter table materials.published_materials
  add column difficulty text,
  add column has_mode_variants boolean not null default false,
  add column outcomes jsonb not null default '[]'::jsonb;

alter table materials.published_materials
  add constraint published_materials_difficulty_valid check (
    difficulty is null or difficulty in ('basic', 'intermediate', 'advanced')
  ),
  add constraint published_materials_outcomes_valid check (
    jsonb_typeof(outcomes) = 'array' and jsonb_array_length(outcomes) <= 4
  );
`;
