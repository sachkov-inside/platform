import { ProductDiscovery } from "../../src/modules/products/index.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { ProductCompositions } from "../../src/modules/products/index.js";
import { assembleProductMaterials } from "../../src/modules/materials/index.js";
import { migrateThrough, upgradeToLatest } from "./setup/historical-upgrade.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

test("upgrade makes automatic programmes explicit before dropping duplicate catalogue placement state", async () => {
  await migrateThrough(database, "0104_products_ownership");
  const auto = randomUUID(),
    explicit = randomUUID(),
    material = randomUUID(),
    extra = randomUUID(),
    chapter = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  const source = "product-source-kept";
  await database.prisma.$executeRaw(
    Prisma.sql`insert into products.series(id,slug,name,source_id,programme_explicit) values (${auto}::uuid,'auto-kept','Automatic',${source},false),(${explicit}::uuid,'explicit-kept','Explicit',null,true)`,
  );
  await database.prisma.$executeRaw(
    Prisma.sql`insert into materials.materials(id,created_by,body,schema_version,access,publication_state,content_version) values (${material}::uuid,${randomUUID()}::uuid,'{"type":"doc","content":[]}'::jsonb,1,'free','draft',1),(${extra}::uuid,${randomUUID()}::uuid,'{"type":"doc","content":[]}'::jsonb,1,'free','draft',1)`,
  );
  await database.prisma.$executeRaw(
    Prisma.sql`insert into products.product_chapters(id,product_id,name,summary,ordinal) values (${chapter}::uuid,${auto}::uuid,'Keep chapter','Keep description',1)`,
  );
  await database.prisma.$executeRaw(
    Prisma.sql`insert into products.product_memberships(product_id,material_id,ordinal,chapter_id,step_group) values (${auto}::uuid,${material}::uuid,1,${chapter}::uuid,'Sequence'),(${explicit}::uuid,${material}::uuid,1,null,null),(${explicit}::uuid,${extra}::uuid,2,null,null)`,
  );
  await database.prisma.$executeRaw(
    Prisma.sql`insert into products.product_programme_placements(id,product_id,material_id,ordinal,step_group) values (${first}::uuid,${explicit}::uuid,${material}::uuid,1,'First'),(${second}::uuid,${explicit}::uuid,${material}::uuid,2,'Again')`,
  );
  await upgradeToLatest(database);
  expect(
    await database.prisma.$queryRaw(
      Prisma.sql`select column_name from information_schema.columns where table_schema='products' and ((table_name='series' and column_name='programme_explicit') or (table_name='product_memberships' and column_name in ('ordinal','chapter_id','step_group')))`,
    ),
  ).toEqual([]);
  expect(
    await database.prisma.$queryRaw(Prisma.sql`
    select constraint_row.conname from pg_constraint constraint_row
    join pg_class source_table on source_table.oid=constraint_row.conrelid
    join pg_namespace source_schema on source_schema.oid=source_table.relnamespace
    join pg_class target_table on target_table.oid=constraint_row.confrelid
    join pg_namespace target_schema on target_schema.oid=target_table.relnamespace
    where constraint_row.contype='f' and (
      (source_schema.nspname='products' and target_schema.nspname<>'products') or
      (source_schema.nspname='materials' and target_schema.nspname in ('products','content_covers'))
    )
  `),
  ).toEqual([]);
  const owner = new ProductCompositions(database.prisma);
  const materials = assembleProductMaterials(
    database.prisma,
    new ProductDiscovery(database.prisma),
  );
  const results = await owner.load({ ids: [auto, explicit] }, 2, {
    async load(ids) {
      return (await materials.load(ids)).map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        published: false,
        topicId: row.topicId,
        hasModeVariants: row.hasModeVariants,
      }));
    },
  });
  const migrated = results.find((product) => product.id === auto);
  expect(migrated?.slug).toBe("auto-kept");
  expect(migrated?.programmePlacements).toHaveLength(1);
  expect(migrated?.programmePlacements[0]).toMatchObject({
    materialId: material,
    chapterId: chapter,
    stepGroup: "Sequence",
  });
  expect(migrated?.chapters).toMatchObject([
    { id: chapter, name: "Keep chapter", summary: "Keep description" },
  ]);
  const preserved = results.find((product) => product.id === explicit);
  expect(
    preserved?.programmePlacements.map((placement) => placement.id),
  ).toEqual([first, second]);
  expect(preserved?.placements).toHaveLength(2);
  expect(
    await database.prisma.product.findUnique({
      where: { id: auto },
      select: { sourceId: true },
    }),
  ).toEqual({ sourceId: source });
});
