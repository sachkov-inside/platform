declare const database: {
  selectFrom(table: string): unknown;
};

database.selectFrom("materials.materials");
