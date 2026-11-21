export const name = "0129_lesson_feedback";

export const statement = `
create table lesson_ratings.feedback (
  id uuid not null unique,
  account_id uuid not null,
  material_id uuid not null,
  text text not null check (char_length(text) between 1 and 2000),
  submitted_at timestamptz not null,
  notification_queued_at timestamptz,
  constraint lesson_feedback_primary primary key (account_id, material_id)
);

create index lesson_feedback_pending
  on lesson_ratings.feedback (submitted_at, id)
  where notification_queued_at is null;
`;
