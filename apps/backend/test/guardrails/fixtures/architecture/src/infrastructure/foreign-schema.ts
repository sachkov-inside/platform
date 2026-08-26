declare const Prisma: {
  sql(parts: TemplateStringsArray): unknown;
};

Prisma.sql`select * from materials.materials`;
