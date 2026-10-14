declare const Prisma: { sql(parts: TemplateStringsArray): unknown };
export const upsert = Prisma.sql`
  INSERT INTO bookmarks.bookmarks (account_id, material_id) VALUES ('account', 'material')
  ON CONFLICT (account_id, material_id) DO UPDATE SET material_id = EXCLUDED.material_id
`;
