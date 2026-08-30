export const name = "0010_material_related_pins";

export const statement = `
create table materials.material_related_pins (
  source_material_id uuid not null,
  target_material_id uuid not null,
  ordinal integer not null,
  constraint material_related_pins_primary
    primary key (source_material_id, target_material_id),
  constraint material_related_pins_source_ordinal_unique
    unique (source_material_id, ordinal),
  constraint material_related_pins_source_fk
    foreign key (source_material_id)
      references materials.materials (id) on delete cascade,
  constraint material_related_pins_target_fk
    foreign key (target_material_id)
      references materials.materials (id) on delete cascade,
  constraint material_related_pins_ordinal_positive check (ordinal > 0),
  constraint material_related_pins_distinct_materials
    check (source_material_id <> target_material_id)
);

create index material_related_pins_target_idx
  on materials.material_related_pins (target_material_id);
`;
