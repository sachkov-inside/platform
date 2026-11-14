export const name = "0124_exercise_attempts";

/**
 * Exercise Attempts (#2121): every checked answer of a signed-in reader to a Lesson Exercise.
 * An exercise is addressed by its Material and the author's exercise id, which survives
 * republication; `fingerprint` names the exercise version the answer was checked against. The
 * partial unique index keeps exactly one first attempt per Account and version, even under
 * concurrent checks. `sequence` orders attempts: two checks in one millisecond still have a
 * latest one, which the clock alone cannot tell. Attempts give no access and no course
 * progress, so nothing references them.
 *
 * Author statistics (#2124) read the first attempts of each version through
 * `exercise_attempts_first_by_version`: respondents, the first-try correct share and the most
 * frequent mistake. `answer` keeps the answer as checked; `mistakes` keeps the items a wrong
 * match or order answer got wrong, which only the check against the version's key can tell.
 */
export const statement = `
create schema exercise_attempts;

create table exercise_attempts.attempts (
  id uuid not null,
  sequence bigint generated always as identity,
  account_id uuid not null,
  material_id uuid not null,
  exercise_id text not null,
  exercise_kind text not null,
  fingerprint text not null,
  answer jsonb not null,
  result text not null,
  mistakes jsonb,
  first_for_version boolean not null,
  attempted_at timestamptz not null,
  constraint exercise_attempts_primary primary key (id),
  constraint exercise_attempts_exercise_id_valid check (
    exercise_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(exercise_id) <= 64
  ),
  constraint exercise_attempts_kind_valid check (
    exercise_kind in ('quiz', 'match', 'order')
  ),
  constraint exercise_attempts_fingerprint_valid check (
    fingerprint ~ '^[0-9a-f]{16}$'
  ),
  constraint exercise_attempts_answer_valid check (
    jsonb_typeof(answer) = 'object'
    and answer ->> 'kind' in ('options', 'matches', 'sequence', 'dontKnow')
  ),
  constraint exercise_attempts_result_valid check (
    result in ('correct', 'incorrect', 'dontKnow')
  ),
  constraint exercise_attempts_mistakes_valid check (
    mistakes is null or (
      result = 'incorrect'
      and jsonb_typeof(mistakes) = 'object'
      and mistakes ->> 'kind' in ('pairs', 'steps')
    )
  )
);

create unique index exercise_attempts_one_first
  on exercise_attempts.attempts (account_id, material_id, exercise_id, fingerprint)
  where first_for_version;

create index exercise_attempts_latest
  on exercise_attempts.attempts (account_id, material_id, exercise_id, sequence desc);

create index exercise_attempts_first_by_version
  on exercise_attempts.attempts (material_id, exercise_id, fingerprint)
  where first_for_version;
`;
