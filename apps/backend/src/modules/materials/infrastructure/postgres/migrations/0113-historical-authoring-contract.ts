export const name = "0113_historical_authoring_contract";
export const statement = `
create table materials.historical_source_records (
  material_id uuid primary key, original jsonb not null
);
insert into materials.historical_source_records(material_id,original)
select id,jsonb_build_object('id',source_id,'path',source_path,'revision',source_revision,'commit',source_commit,'showInFeed',show_in_feed)
from materials.materials where source_id is not null;
alter table materials.materials drop column show_in_feed;
alter table materials.practice_definitions rename to historical_practice_definitions;
`;
