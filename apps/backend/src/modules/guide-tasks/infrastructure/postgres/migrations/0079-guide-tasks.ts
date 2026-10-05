export const name = "0079_guide_tasks";

// Guide Task (#946): an assignment in one Guide chapter with immutable requirement versions,
// learner submissions and author feedback. Guide and chapter live in Materials, so they are
// referenced by ID without a cross-schema foreign key (ADR 0003). Versions and submissions only
// grow; author feedback is the one record an author changes.
export const statement = `
CREATE SCHEMA guide_tasks;

CREATE TABLE guide_tasks.tasks (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  source_id text NOT NULL,
  guide_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 1000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  access text NOT NULL CHECK (access IN ('free', 'membership')),
  related_material_source_ids text[] NOT NULL CHECK (cardinality(related_material_source_ids) <= 50),
  publication_state text NOT NULL CHECK (publication_state IN ('published', 'unpublished')),
  current_version integer NOT NULL CHECK (current_version > 0),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT tasks_code_unique UNIQUE (code),
  CONSTRAINT tasks_source_unique UNIQUE (source_id),
  CONSTRAINT tasks_code_valid CHECK (
    char_length(code) <= 120 AND code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  CONSTRAINT tasks_source_names_code CHECK (
    char_length(source_id) <= 200 AND source_id ~ ('^[a-z0-9]+(-[a-z0-9]+)*:' || code || '$')
  )
);
CREATE INDEX tasks_chapter_order ON guide_tasks.tasks (guide_id, chapter_id, position, code);

CREATE TABLE guide_tasks.task_versions (
  task_id uuid NOT NULL REFERENCES guide_tasks.tasks(id),
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  definition_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  source_repository text NOT NULL,
  source_commit char(40) NOT NULL,
  source_path text NOT NULL,
  CONSTRAINT task_versions_primary PRIMARY KEY (task_id, version)
);
ALTER TABLE guide_tasks.tasks ADD CONSTRAINT tasks_current_version_exists
  FOREIGN KEY (id, current_version) REFERENCES guide_tasks.task_versions (task_id, version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE guide_tasks.import_receipts (
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation = 'apply_guide_task'),
  idempotency_key text NOT NULL,
  request_fingerprint char(64) NOT NULL,
  receipt jsonb,
  CONSTRAINT import_receipts_primary PRIMARY KEY (actor_id, operation, idempotency_key)
);

CREATE TABLE guide_tasks.submissions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  task_id uuid NOT NULL,
  task_version integer NOT NULL,
  submission_key text NOT NULL CHECK (char_length(submission_key) BETWEEN 1 AND 200),
  request_fingerprint char(64) NOT NULL,
  source text NOT NULL CHECK (source IN ('mcp', 'form')),
  review_report jsonb,
  note text NOT NULL CHECK (char_length(note) <= 1000),
  repository_url text CHECK (char_length(repository_url) BETWEEN 1 AND 500),
  branch text CHECK (char_length(branch) BETWEEN 1 AND 250),
  commit_sha text CHECK (commit_sha ~ '^[0-9a-f]{7,64}$'),
  uncommitted_changes boolean,
  submitted_at timestamptz NOT NULL,
  CONSTRAINT submissions_version_exists FOREIGN KEY (task_id, task_version)
    REFERENCES guide_tasks.task_versions (task_id, version),
  CONSTRAINT submissions_key_unique UNIQUE (account_id, submission_key),
  CONSTRAINT submissions_mcp_has_report CHECK (source <> 'mcp' OR review_report IS NOT NULL)
);
CREATE INDEX submissions_account_task ON guide_tasks.submissions (account_id, task_id, submitted_at DESC, id);
CREATE INDEX submissions_account_time ON guide_tasks.submissions (account_id, submitted_at);
CREATE INDEX submissions_task_time ON guide_tasks.submissions (task_id, submitted_at DESC, id);

CREATE TABLE guide_tasks.author_feedback (
  submission_id uuid PRIMARY KEY REFERENCES guide_tasks.submissions(id),
  comment text CHECK (char_length(comment) BETWEEN 1 AND 4000),
  reviewed_at timestamptz,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE FUNCTION guide_tasks.reject_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME; END;
$$;
CREATE TRIGGER task_versions_append_only BEFORE UPDATE OR DELETE ON guide_tasks.task_versions
  FOR EACH ROW EXECUTE FUNCTION guide_tasks.reject_rewrite();
CREATE TRIGGER submissions_append_only BEFORE UPDATE OR DELETE ON guide_tasks.submissions
  FOR EACH ROW EXECUTE FUNCTION guide_tasks.reject_rewrite();
`;
