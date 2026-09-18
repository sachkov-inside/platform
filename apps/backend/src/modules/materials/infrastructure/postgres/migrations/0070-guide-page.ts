export const name = "0070_guide_page";

// Оформление и описание страницы продукта переносятся из авторского оригинала (ADR 0026).
// Набор оформлений живёт в коде: база проверяет только форму имени и то, что описание — объект.
export const statement = `
alter table materials.series
  add column presentation text not null default 'default',
  add column page jsonb,
  add constraint series_presentation_valid check (presentation ~ '^[a-z][a-z0-9-]{0,63}$'),
  add constraint series_page_object check (page is null or jsonb_typeof(page) = 'object');
`;
