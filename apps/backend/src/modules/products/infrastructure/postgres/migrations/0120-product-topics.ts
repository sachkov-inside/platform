export const name = "0120_product_topics";

/** Product topics group catalogue Materials; each Material joins at most one topic of its Product. */
export const statement = `
create table products.product_topics (
  id uuid not null,
  product_id uuid not null,
  name text not null,
  summary text not null default '',
  ordinal integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_topics_primary primary key (id),
  constraint product_topics_product_fk foreign key (product_id)
    references products.products (id) on delete cascade,
  constraint product_topics_identity_unique unique (id, product_id),
  constraint product_topics_ordinal_unique unique (product_id, ordinal)
    deferrable initially deferred,
  constraint product_topics_ordinal_positive check (ordinal > 0),
  constraint product_topics_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 120
  ),
  constraint product_topics_summary_valid check (
    summary = btrim(summary) and char_length(summary) <= 300
  )
);

create table products.product_topic_materials (
  product_id uuid not null,
  topic_id uuid not null,
  material_id uuid not null,
  constraint product_topic_materials_primary primary key (product_id, material_id),
  constraint product_topic_materials_topic_fk foreign key (topic_id, product_id)
    references products.product_topics (id, product_id) on delete cascade,
  constraint product_topic_materials_membership_fk foreign key (product_id, material_id)
    references products.product_memberships (product_id, material_id) on delete cascade
);

create index product_topic_materials_topic_idx
  on products.product_topic_materials (topic_id);
`;
