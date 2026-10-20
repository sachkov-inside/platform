export const name = "0102_material_telegram_announcements";
export const statement = `
ALTER TABLE materials.materials ADD COLUMN notify_telegram boolean;
ALTER TABLE materials.publication_announcements ADD COLUMN telegram_enabled boolean NOT NULL DEFAULT false, ADD COLUMN telegram_managed boolean NOT NULL DEFAULT false;
`;
