export const name = "0104_funnel_diagnostic_current_products";

export const statement = `
create index series_current_diagnostics on materials.series(name,id) where archived_at is null;
`;
