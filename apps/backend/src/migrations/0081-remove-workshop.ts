export const name = "0081_remove_workshop";

// #1063: production inspected read-only on 2026-10-07; the owner approved removing its
// single derived membership projection. No workshop Materials or Videos existed.
export const statement = `
  do $$
  begin
    if exists (select 1 from workshop.entitlements)
      or exists (select 1 from workshop.cases)
      or exists (select 1 from workshop.case_versions)
      or exists (select 1 from workshop.case_materials)
      or exists (select 1 from workshop.hint_reveals)
      or exists (select 1 from workshop.solution_reveals) then
      raise exception 'Workshop business data requires an owner decision';
    end if;
  end;
  $$;

  alter table materials.materials
    drop constraint materials_access_check,
    add constraint materials_access_check check (access in ('free', 'membership'));
  alter table materials.published_materials
    drop constraint published_materials_access_check,
    add constraint published_materials_access_check check (access in ('free', 'membership'));
  alter table videos.videos
    drop constraint videos_access_check,
    add constraint videos_access_check check (access in ('free', 'membership'));
  alter table videos.upload_attempts
    drop constraint video_upload_attempts_access_check,
    add constraint video_upload_attempts_access_check check (access in ('free', 'membership'));

  alter table workshop.cases drop constraint workshop_cases_current_version_fk;
  drop table workshop.case_materials;
  drop table workshop.hint_reveals;
  drop table workshop.solution_reveals;
  drop table workshop.case_versions;
  drop table workshop.cases;
  drop table workshop.entitlements;
  drop table workshop.membership_entitlement_projections;
  drop function workshop.reject_immutable_record_change();
  drop function workshop.reject_case_version_change();
  drop schema workshop;
`;
