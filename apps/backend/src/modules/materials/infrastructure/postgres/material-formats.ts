import { Prisma } from "../../../../infrastructure/prisma/index.js";
import { materialFormats } from "../../domain/material-format.js";

export const materialFormatsSql = Prisma.sql`values ${Prisma.join(
  materialFormats.map(({ id, slug, name }) => Prisma.sql`(${id}, ${slug}, ${name})`),
)}`;
