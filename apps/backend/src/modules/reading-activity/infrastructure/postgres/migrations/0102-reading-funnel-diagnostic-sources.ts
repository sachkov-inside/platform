export const name = "0102_reading_funnel_diagnostic_sources";

export const statement = `
create index material_visits_material_first on reading_activity.material_visits(material_id, account_id, first_opened_at);
`;
