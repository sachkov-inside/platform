export const name = "0057_guide_introduction";

export const statement = `
alter table materials.series
  add column audience text not null default '',
  add column outcome text not null default '',
  add column prerequisites text not null default '',
  add column scope text not null default '';

alter table materials.series
  add constraint series_audience_valid check (
    audience = btrim(audience) and char_length(audience) <= 4000
  ),
  add constraint series_outcome_valid check (
    outcome = btrim(outcome) and char_length(outcome) <= 4000
  ),
  add constraint series_prerequisites_valid check (
    prerequisites = btrim(prerequisites) and char_length(prerequisites) <= 4000
  ),
  add constraint series_scope_valid check (
    scope = btrim(scope) and char_length(scope) <= 4000
  );
`;
