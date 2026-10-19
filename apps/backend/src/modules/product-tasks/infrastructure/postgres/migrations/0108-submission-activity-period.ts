export const name = "0108_submission_activity_period";
export const statement = `
CREATE INDEX submission_activity_period ON product_tasks.submissions (submitted_at, account_id);
`;
