declare const Prisma: { sql(parts: TemplateStringsArray): unknown };
Prisma.sql`select * from billing.notification_outbox`;
