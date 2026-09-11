export const name = "0060_material_announcements";

export const statement = `
create table materials.publication_announcements (
  id uuid primary key,
  material_id uuid not null unique references materials.materials(id),
  revision int not null check (revision >= 1),
  occurred_at timestamptz not null,
  not_after timestamptz not null,
  -- Верхняя граница взята у шаблона Notifications, а не у заголовка материала: она заведомо
  -- шире собственного предела Materials, поэтому публикация на ней упасть не может.
  title text not null check (char_length(title) between 1 and 1500),
  -- Форму ссылки задаёт materialReaderPath в домене Materials; здесь она только не даёт
  -- записать повод, из которого получится чужой или нерабочий адрес читателя.
  reader_path text not null check (reader_path ~ '^/materials/[a-z0-9-]+$'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (occurred_at < not_after)
);

create table materials.publication_announcement_revisions (
  announcement_ref uuid not null references materials.publication_announcements(id),
  revision int not null check (revision >= 1),
  message_id uuid not null unique,
  payload jsonb not null,
  created_at timestamptz not null,
  primary key (announcement_ref, revision)
);

create function materials.immutable_announcement_revision()
returns trigger
language plpgsql
as $$
begin
  raise exception 'publication announcement revision is immutable';
end;
$$;

create trigger immutable_announcement_revision
before update or delete on materials.publication_announcement_revisions
for each row execute function materials.immutable_announcement_revision();

-- Анонс существует только у материала, который уже публиковался: без этого повторное
-- сохранение давно опубликованного материала выдало бы себя за первую публикацию.
create function materials.protect_announcement()
returns trigger
language plpgsql
as $$
declare
  published_at timestamptz;
begin
  if tg_op = 'INSERT' then
    select first_published_at into published_at from materials.materials where id = new.material_id;
    if published_at is null then
      raise exception 'publication announcement requires a published Material';
    end if;
    return new;
  end if;
  if row(new.material_id, new.occurred_at, new.not_after)
    is distinct from row(old.material_id, old.occurred_at, old.not_after)
  then
    raise exception 'publication occurrence is immutable';
  end if;
  if new.revision < old.revision then
    raise exception 'publication announcement revision cannot go backwards';
  end if;
  return new;
end;
$$;

create trigger protect_announcement
before insert or update on materials.publication_announcements
for each row execute function materials.protect_announcement();
`;
