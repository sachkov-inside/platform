export const name = "0050_guide_artifacts";

export const statement = `
  create table materials.guide_artifacts (
    id uuid primary key,
    title varchar(200) not null,
    purpose varchar(1000) not null default '',
    access text not null,
    origin text not null,
    source_id varchar(200),
    imported_at timestamptz,
    imported_revision integer,
    revision integer not null default 1,
    current_version integer not null,
    state text not null,
    created_by uuid not null,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint guide_artifacts_title_check check (length(btrim(title)) > 0),
    constraint guide_artifacts_access_check check (access in ('free', 'membership')),
    constraint guide_artifacts_origin_check check (origin in ('platform', 'authoring')),
    constraint guide_artifacts_state_check check (state in ('active', 'archived')),
    constraint guide_artifacts_revision_check check (revision >= 1),
    constraint guide_artifacts_current_version_check check (current_version >= 1),
    constraint guide_artifacts_archive_shape_check check (
      (state = 'archived') = (archived_at is not null)
    ),
    constraint guide_artifacts_origin_shape_check check (
      (origin = 'platform'
        and source_id is null
        and imported_at is null
        and imported_revision is null)
      or (origin = 'authoring' and source_id is not null)
    ),
    constraint guide_artifacts_source_unique unique (source_id)
  );

  create index guide_artifacts_state_idx
    on materials.guide_artifacts (state, updated_at desc);

  create table materials.guide_artifact_versions (
    artifact_id uuid not null,
    version integer not null,
    content_kind text not null,
    external_url varchar(2048),
    original_filename varchar(255),
    content_type varchar(255),
    byte_size integer,
    checksum_sha256 char(64),
    object_nonce uuid,
    quarantine_object_key varchar(512),
    protected_object_key varchar(512),
    public_object_key varchar(512),
    created_by uuid not null,
    created_at timestamptz not null default now(),
    superseded_at timestamptz,
    constraint guide_artifact_versions_primary primary key (artifact_id, version),
    constraint guide_artifact_versions_artifact_fk foreign key (artifact_id)
      references materials.guide_artifacts (id) on delete cascade,
    constraint guide_artifact_versions_version_check check (version >= 1),
    constraint guide_artifact_versions_kind_check check (content_kind in ('file', 'link')),
    constraint guide_artifact_versions_link_shape_check check (
      content_kind <> 'link'
      or (
        external_url is not null
        and original_filename is null
        and quarantine_object_key is null
        and protected_object_key is null
        and public_object_key is null
      )
    ),
    -- A file version row exists only after its bytes left quarantine, passed
    -- inspection and reached protected and public storage.
    constraint guide_artifact_versions_file_shape_check check (
      content_kind <> 'file'
      or (
        external_url is null
        and original_filename is not null
        and object_nonce is not null
        and quarantine_object_key is not null
        and content_type is not null
        and byte_size is not null
        and checksum_sha256 is not null
        and protected_object_key is not null
        and public_object_key is not null
      )
    ),
    constraint guide_artifact_versions_byte_size_check check (
      byte_size is null or byte_size > 0
    )
  );

  create table materials.guide_artifact_placements (
    artifact_id uuid not null,
    guide_id uuid not null,
    created_at timestamptz not null default now(),
    constraint guide_artifact_placements_primary primary key (artifact_id, guide_id),
    constraint guide_artifact_placements_artifact_fk foreign key (artifact_id)
      references materials.guide_artifacts (id) on delete restrict,
    constraint guide_artifact_placements_guide_fk foreign key (guide_id)
      references materials.series (id) on delete cascade
  );

  create index guide_artifact_placements_guide_idx
    on materials.guide_artifact_placements (guide_id, created_at);

  create table materials.guide_artifact_material_links (
    artifact_id uuid not null,
    material_id uuid not null,
    created_at timestamptz not null default now(),
    constraint guide_artifact_material_links_primary primary key (artifact_id, material_id),
    constraint guide_artifact_material_links_artifact_fk foreign key (artifact_id)
      references materials.guide_artifacts (id) on delete restrict,
    constraint guide_artifact_material_links_material_fk foreign key (material_id)
      references materials.materials (id) on delete cascade
  );

  create index guide_artifact_material_links_material_idx
    on materials.guide_artifact_material_links (material_id);
`;
