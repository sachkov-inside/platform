export const name = "0065_guide_material_removals";

/**
 * Журнал подтверждённых снятий опубликованного материала из руководства, у которого были
 * держатели права. Запись фиксирует, кто снял, сколько людей держали право и какой операцией.
 */
export const statement = `
create table materials.guide_material_removals (
  id uuid primary key,
  guide_id uuid not null references materials.series(id),
  material_id uuid not null references materials.materials(id),
  actor_account_id uuid not null,
  holders integer not null check (holders > 0),
  operation text not null check (operation in ('material_save', 'guide_composition')),
  removed_at timestamptz not null
);

create index guide_material_removals_guide_idx
  on materials.guide_material_removals (guide_id, removed_at desc);
`;
