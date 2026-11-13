export const name = "0128_lesson_ratings";

/**
 * Lesson Ratings (#2124): «Как вам урок?», one like or dislike of a signed-in reader per
 * Material. A new rating replaces the old one and a removed rating deletes the row, so the
 * table holds only current ratings. Ratings give no access and no course progress, so nothing
 * references them; `lesson_ratings_by_material` serves the author's counts.
 */
export const statement = `
create schema lesson_ratings;

create table lesson_ratings.ratings (
  account_id uuid not null,
  material_id uuid not null,
  rating text not null,
  rated_at timestamptz not null,
  constraint lesson_ratings_primary primary key (account_id, material_id),
  constraint lesson_ratings_rating_valid check (rating in ('like', 'dislike'))
);

create index lesson_ratings_by_material
  on lesson_ratings.ratings (material_id, rating);
`;
