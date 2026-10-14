import { Prisma } from "../../../../../infrastructure/prisma/index.js";
export const upsert = Prisma.sql`
  INSERT INTO bookmarks.bookmarks (account_id, material_id) VALUES ('account', 'material')
  ON CONFLICT (account_id, material_id) DO UPDATE SET material_id = EXCLUDED.material_id
`;
