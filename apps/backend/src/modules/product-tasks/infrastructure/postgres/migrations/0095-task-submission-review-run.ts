export const name = "0095_task_submission_review_run";
export const statement = `
ALTER TABLE product_tasks.submissions ADD COLUMN review_run_key uuid;
CREATE INDEX submissions_review_run ON product_tasks.submissions(account_id, task_id, review_run_key);
`;
