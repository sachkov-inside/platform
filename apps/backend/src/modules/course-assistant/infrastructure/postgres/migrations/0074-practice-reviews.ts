export const name = "0074_course_assistant_practice_reviews";
export const statement = `
CREATE TABLE course_assistant.assistant_conversations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  practice_id text NOT NULL CHECK (char_length(practice_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, practice_id)
);
CREATE TABLE course_assistant.practice_reviews (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  practice_id text NOT NULL CHECK (char_length(practice_id) BETWEEN 1 AND 200),
  conversation_id uuid NOT NULL REFERENCES course_assistant.assistant_conversations (id),
  kind text NOT NULL CHECK (kind IN ('initial', 'recheck')),
  state text NOT NULL CHECK (state IN ('queued', 'awaiting_choice', 'running', 'completed', 'failed')),
  context_version text NOT NULL CHECK (char_length(context_version) = 64),
  installation_id bigint NOT NULL CHECK (installation_id > 0),
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  repository_full_name text NOT NULL CHECK (char_length(repository_full_name) BETWEEN 3 AND 200),
  requested_candidate jsonb,
  candidates jsonb,
  checked_candidate jsonb,
  report jsonb,
  practice_status text CHECK (practice_status IN ('accepted', 'needs_work')),
  previous_review_id uuid REFERENCES course_assistant.practice_reviews (id),
  failure jsonb,
  requested_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  CHECK ((state = 'completed') = (report IS NOT NULL AND practice_status IS NOT NULL)),
  CHECK ((state = 'failed') = (failure IS NOT NULL)),
  CHECK ((state IN ('completed', 'failed')) = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX practice_reviews_one_active
  ON course_assistant.practice_reviews (account_id, practice_id)
  WHERE state IN ('queued', 'awaiting_choice', 'running');
CREATE INDEX practice_reviews_history
  ON course_assistant.practice_reviews (account_id, practice_id, requested_at DESC, id);
CREATE INDEX practice_reviews_pending
  ON course_assistant.practice_reviews (requested_at) WHERE state IN ('queued', 'running');
CREATE TABLE course_assistant.assistant_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES course_assistant.assistant_conversations (id),
  position bigint GENERATED ALWAYS AS IDENTITY,
  role text NOT NULL CHECK (role IN ('participant', 'assistant')),
  kind text NOT NULL CHECK (kind IN ('text', 'candidate_question', 'review_result')),
  text text CHECK (char_length(text) BETWEEN 1 AND 4000),
  review_id uuid REFERENCES course_assistant.practice_reviews (id),
  created_at timestamptz NOT NULL,
  CHECK ((kind = 'text') = (text IS NOT NULL)),
  CHECK (kind = 'text' OR (role = 'assistant' AND review_id IS NOT NULL))
);
CREATE UNIQUE INDEX assistant_messages_order
  ON course_assistant.assistant_messages (conversation_id, position);
CREATE UNIQUE INDEX assistant_messages_one_per_review_stage
  ON course_assistant.assistant_messages (review_id, kind) WHERE kind <> 'text';
CREATE TABLE course_assistant.assistant_usages (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  practice_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES course_assistant.assistant_conversations (id),
  review_id uuid REFERENCES course_assistant.practice_reviews (id),
  step integer NOT NULL CHECK (step >= 0),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 64),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 200),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens integer NOT NULL CHECK (cached_input_tokens >= 0),
  cache_write_tokens integer NOT NULL CHECK (cache_write_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cost_nano_usd bigint CHECK (cost_nano_usd >= 0),
  price_table_version text CHECK (char_length(price_table_version) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL,
  CHECK ((cost_nano_usd IS NULL) = (price_table_version IS NULL))
);
CREATE INDEX assistant_usages_account
  ON course_assistant.assistant_usages (account_id, created_at DESC);
CREATE INDEX assistant_usages_review
  ON course_assistant.assistant_usages (review_id, step);
`;
