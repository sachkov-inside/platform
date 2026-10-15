export const name = "0094_task_review_progress";
export const statement = `
CREATE TABLE product_tasks.review_progress (
  account_id uuid NOT NULL,
  task_id uuid NOT NULL,
  task_version integer NOT NULL,
  run_key uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  phase text NOT NULL CHECK (phase IN ('reviewing', 'ready', 'stopped', 'submitted')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  review_report jsonb CHECK (octet_length(review_report::text) <= 100000),
  request_fingerprint char(64) NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT review_progress_primary PRIMARY KEY (account_id, task_id),
  FOREIGN KEY (task_id, task_version) REFERENCES product_tasks.task_versions(task_id, version)
);`;
