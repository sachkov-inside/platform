import { z } from "zod";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  decodeProductAccessCursor,
  encodeProductAccessCursor,
  productAccessListQuerySchema,
  productAccessListScope,
  productAccessViewSchema,
  type ProductAccessListPosition,
  type ProductAccessListScope,
} from "../../domain/product-access.js";
import type { AccountRightsPrisma } from "../../infrastructure/prisma.js";

const rowsSchema = z.array(
  z.object({
    account_id: z.uuid(),
    product_id: z.uuid(),
    first_issued_at: z.date().nullable(),
    revoked: z.boolean(),
    revision: z.int().positive(),
  }),
);
type Row = z.infer<typeof rowsSchema>[number];

/**
 * The owner's bounded Product Access inventory. The caller has checked `billing:manage`.
 * Every filter and the order are part of the cursor scope, so a cursor never continues a
 * different list.
 */
export async function listProductAccess(
  prisma: Pick<AccountRightsPrisma, "$queryRaw">,
  input: unknown,
) {
  const query = productAccessListQuerySchema.safeParse(input);
  if (!query.success) return accessFailure("invalid_input");
  const scope = productAccessListScope(query.data);
  const sort = query.data.order === "recent" ? "recent" : "account-product-asc";
  const position =
    query.data.cursor === undefined
      ? undefined
      : decodeProductAccessCursor(query.data.cursor, scope, sort);
  if (position === null) return accessFailure("invalid_input");
  const limit = query.data.limit;
  const rows = rowsSchema.parse(
    await prisma.$queryRaw(Prisma.sql`
      select account_id, product_id,
        date_trunc('milliseconds', first_issued_at) as first_issued_at,
        revoked_at is not null as revoked, revision
      from account_rights.product_access
      where ${Prisma.join([...filters(scope), ...continuation(position)], " and ")}
      order by ${
        sort === "recent"
          ? Prisma.sql`date_trunc('milliseconds', first_issued_at) desc nulls last, account_id, product_id`
          : Prisma.sql`account_id, product_id`
      }
      limit ${limit + 1}
    `),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    ok: true as const,
    value: page.map((row) =>
      productAccessViewSchema.parse({
        accountId: row.account_id,
        productId: row.product_id,
        revision: row.revision,
        firstIssuedAt: row.first_issued_at?.toISOString() ?? null,
        access: row.revoked ? "revoked" : "active",
      }),
    ),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeProductAccessCursor(scope, positionAfter(sort, last))
        : null,
  };
}

function filters(scope: ProductAccessListScope) {
  return [
    Prisma.sql`true`,
    ...(scope.accountId === null
      ? []
      : [Prisma.sql`account_id = ${scope.accountId}::uuid`]),
    ...(scope.productId === null
      ? []
      : [Prisma.sql`product_id = ${scope.productId}::uuid`]),
    ...(scope.access === null
      ? []
      : [
          scope.access === "active"
            ? Prisma.sql`revoked_at is null`
            : Prisma.sql`revoked_at is not null`,
        ]),
    ...(scope.accountIds === null
      ? []
      : [
          Prisma.sql`account_id in (${Prisma.join(
            scope.accountIds.map((id) => Prisma.sql`${id}::uuid`),
          )})`,
        ]),
  ];
}

function continuation(position: ProductAccessListPosition | undefined) {
  if (position === undefined) return [];
  if (position.sort === "account-product-asc")
    return [
      Prisma.sql`(account_id, product_id) > (${position.after[0]}::uuid, ${position.after[1]}::uuid)`,
    ];
  const [issuedAt, account, product] = position.after;
  const tie = Prisma.sql`(account_id, product_id) > (${account}::uuid, ${product}::uuid)`;
  if (issuedAt === null)
    return [Prisma.sql`first_issued_at is null and ${tie}`];
  const issued = Prisma.sql`date_trunc('milliseconds', first_issued_at)`;
  return [
    Prisma.sql`(first_issued_at is null or ${issued} < ${new Date(issuedAt)} or (${issued} = ${new Date(issuedAt)} and ${tie}))`,
  ];
}

function positionAfter(
  sort: ProductAccessListPosition["sort"],
  row: Row,
): ProductAccessListPosition {
  return sort === "recent"
    ? {
        sort,
        after: [
          row.first_issued_at?.toISOString() ?? null,
          row.account_id,
          row.product_id,
        ],
      }
    : { sort, after: [row.account_id, row.product_id] };
}
