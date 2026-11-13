export const name = "0123_glossary_term_marks";

/**
 * A reader's mark on a Glossary Term from the lesson deck «Термины урока» (#2127): «знаю» or
 * «повторить». One mark per Account and term; a newer mark replaces the older one. A term removed
 * from the Glossary takes its marks with it. The index serves the deck and the course Glossary,
 * which read terms by their introducing Material.
 */
export const statement = `
create table glossary.term_marks (
  account_id uuid not null,
  term_id text not null,
  mark text not null,
  marked_at timestamptz not null,
  constraint glossary_term_marks_primary primary key (account_id, term_id),
  constraint glossary_term_marks_term_fk foreign key (term_id)
    references glossary.terms (id) on delete cascade,
  constraint glossary_term_marks_mark_valid check (mark in ('known', 'review'))
);

create index glossary_terms_introduced_in_idx
  on glossary.terms (introduced_in_source_id);
`;
