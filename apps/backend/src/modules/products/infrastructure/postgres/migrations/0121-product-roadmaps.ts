export const name = "0121_product_roadmaps";

/**
 * A Product roadmap tells readers which chapters are written, in progress or planned. It is
 * Platform presentation of the programme, so one row per Product is replaced as a whole.
 */
export const statement = `
create table products.product_roadmaps (
  product_id uuid not null,
  updated_on date not null,
  chapters jsonb not null,
  updated_at timestamptz not null default now(),
  constraint product_roadmaps_primary primary key (product_id),
  constraint product_roadmaps_product_fk foreign key (product_id)
    references products.products (id) on delete cascade,
  constraint product_roadmaps_chapters_array check (jsonb_typeof(chapters) = 'array')
);
`;
