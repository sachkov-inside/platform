export const name = "0123_glossary_terms";

/**
 * Glossary Terms (#2126). A term keeps its permanent identifier, the slug authors write in
 * `term:<id>`; Materials reference it by that identifier, so the table has no foreign key into
 * Materials. The introducing Material is recorded by its authoring source identifier, which stays
 * the same across environments and exists before the Material is imported. The index serves the
 * course Glossary, which reads terms by their introducing Material.
 */
export const statement = `
create schema glossary;

create table glossary.terms (
  id text not null,
  title text not null,
  english_title text,
  short_definition text not null,
  full_definition text not null,
  introduced_in_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glossary_terms_primary primary key (id),
  constraint glossary_terms_id_valid check (
    id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 120
  ),
  constraint glossary_terms_title_valid check (
    title = btrim(title) and char_length(title) between 1 and 120
  ),
  constraint glossary_terms_english_title_valid check (
    english_title is null or (
      english_title = btrim(english_title)
      and char_length(english_title) between 1 and 120
    )
  ),
  constraint glossary_terms_short_definition_valid check (
    short_definition = btrim(short_definition)
    and char_length(short_definition) between 1 and 300
  ),
  constraint glossary_terms_full_definition_valid check (
    full_definition = btrim(full_definition)
    and char_length(full_definition) between 1 and 4000
  ),
  constraint glossary_terms_introduced_in_valid check (
    introduced_in_source_id is null
    or char_length(introduced_in_source_id) between 1 and 200
  )
);

create index glossary_terms_introduced_in_idx
  on glossary.terms (introduced_in_source_id);
`;
