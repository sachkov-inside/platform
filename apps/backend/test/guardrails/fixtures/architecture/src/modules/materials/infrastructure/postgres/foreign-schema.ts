declare const database: {
  selectFrom(table: string): unknown;
};

database.selectFrom("materials");
database.selectFrom("identity_principals.principals");

const dynamicTable = "identity_principals.principals";
database.selectFrom(dynamicTable);

declare const sql: {
  (parts: TemplateStringsArray): unknown;
  raw(value: string): unknown;
};

sql`select * from "identity_principals"."principals"`;
sql.raw("select * from identity_principals.principals");
sql.raw(dynamicTable);
