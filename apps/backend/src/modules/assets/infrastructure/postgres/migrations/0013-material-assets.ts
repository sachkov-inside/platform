export const name = "0013_material_assets";

export const statement = `
  create schema assets;

  create table assets.material_assets (
    id uuid primary key,
    material_id uuid not null,
    uploaded_by uuid not null,
    kind text not null,
    state text not null,
    idempotency_key varchar(128) not null,
    request_fingerprint char(64) not null,
    original_filename varchar(255) not null,
    declared_content_type varchar(255) not null,
    declared_size integer not null,
    expected_checksum char(64) not null,
    actual_content_type varchar(255),
    actual_size integer,
    actual_checksum char(64),
    width integer,
    height integer,
    object_nonce uuid not null,
    quarantine_object_key varchar(512) not null,
    protected_object_key varchar(512),
    public_object_key varchar(512),
    failure_code varchar(64),
    orphaned_at timestamptz not null default now(),
    cleanup_claimed_at timestamptz,
    ready_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint material_assets_kind_check check (kind in ('image', 'file')),
    constraint material_assets_state_check check (state in ('pending', 'processing', 'ready', 'failed')),
    constraint material_assets_declared_size_check check (declared_size >= 0),
    constraint material_assets_actual_size_check check (actual_size is null or actual_size >= 0),
    constraint material_assets_dimensions_check check (
      (kind = 'image' and width is null and height is null)
      or (kind = 'image' and width > 0 and height > 0)
      or (kind = 'file' and width is null and height is null)
    ),
    constraint material_assets_ready_shape_check check (
      state <> 'ready'
      or (
        actual_content_type is not null
        and actual_size is not null
        and actual_checksum is not null
        and protected_object_key is not null
        and ready_at is not null
      )
    ),
    constraint material_assets_upload_idempotency_unique
      unique (material_id, uploaded_by, idempotency_key)
  );

  create index material_assets_material_state_idx
    on assets.material_assets (material_id, state);
  create index material_assets_cleanup_idx
    on assets.material_assets (state, orphaned_at);

  create table assets.material_asset_variants (
    asset_id uuid not null,
    width integer not null,
    height integer not null,
    content_type varchar(255) not null,
    byte_size integer not null,
    checksum_sha256 char(64) not null,
    protected_object_key varchar(512) not null,
    public_object_key varchar(512) not null,
    constraint material_asset_variants_primary primary key (asset_id, width),
    constraint material_asset_variants_asset_fk foreign key (asset_id)
      references assets.material_assets (id) on delete cascade,
    constraint material_asset_variants_dimensions_check check (width > 0 and height > 0),
    constraint material_asset_variants_byte_size_check check (byte_size > 0)
  );
`;
