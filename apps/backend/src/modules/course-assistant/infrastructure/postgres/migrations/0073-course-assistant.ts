export const name = "0073_course_assistant";
export const statement = `
CREATE SCHEMA course_assistant;
CREATE TABLE course_assistant.data_notice_acknowledgements (
  account_id uuid NOT NULL,
  notice_version text NOT NULL CHECK (char_length(notice_version) BETWEEN 1 AND 64),
  acknowledged_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, notice_version)
);
CREATE TABLE course_assistant.repository_connection_attempts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  state_digest text NOT NULL UNIQUE CHECK (char_length(state_digest) = 64),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  completed_at timestamptz
);
CREATE INDEX repository_connection_attempts_account
  ON course_assistant.repository_connection_attempts (account_id, created_at DESC);
CREATE TABLE course_assistant.github_installations (
  account_id uuid NOT NULL,
  installation_id bigint NOT NULL CHECK (installation_id > 0),
  github_login text NOT NULL CHECK (char_length(github_login) BETWEEN 1 AND 100),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, installation_id)
);
CREATE TABLE course_assistant.repository_links (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  installation_id bigint NOT NULL CHECK (installation_id > 0),
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  repository_full_name text NOT NULL CHECK (char_length(repository_full_name) BETWEEN 3 AND 200),
  connected_at timestamptz NOT NULL,
  disconnected_at timestamptz,
  CHECK (disconnected_at IS NULL OR disconnected_at >= connected_at)
);
CREATE UNIQUE INDEX repository_links_one_active
  ON course_assistant.repository_links (account_id) WHERE disconnected_at IS NULL;
CREATE INDEX repository_links_history
  ON course_assistant.repository_links (account_id, connected_at DESC, id);
`;
