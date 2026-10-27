export const name = "0118_funnel_diagnostic_current_products";

export const statement = `
create index products_current_diagnostics on products.products(name,id) where archived_at is null;
`;
