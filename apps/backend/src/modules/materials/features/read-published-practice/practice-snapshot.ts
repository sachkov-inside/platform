import { z } from "zod";
import {
  Prisma,
  type MaterialsPrisma,
} from "../../../../infrastructure/prisma/index.js";
import { practiceDefinitionSchema } from "../../domain/practice-definition.js";

const version = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const snapshotSchema = z.object({
  practice_id: z.string(),
  practice_version: version,
  definition_digest: z.string(),
  definition: practiceDefinitionSchema,
  publication_state: z.enum(["published", "unpublished"]),
  material_id: z.uuid(),
  bound_source_id: z.string(),
  bound_source_revision: z.string(),
  bound_content_version: version,
  source_repository: z.string(),
  source_commit: z.string(),
  source_path: z.string(),
  material_slug: z.string().nullable(),
  material_state: z.enum(["draft", "published", "unpublished"]),
  material_version: version,
  material_source_id: z.string().nullable(),
  material_source_revision: z.string().nullable(),
});

export type PracticeSnapshot = z.infer<typeof snapshotSchema>;

/** One statement observes complete bindings and lifecycles, including concurrent withdrawal. */
async function selectSnapshots(prisma: MaterialsPrisma, where: Prisma.Sql) {
  return z.array(snapshotSchema).parse(
    await prisma.$queryRaw(Prisma.sql`
    select p.practice_id, p.practice_version, p.definition_digest, p.definition, p.publication_state,
      p.material_id, p.bound_source_id, p.bound_source_revision, p.bound_content_version,
      p.source_repository, p.source_commit, p.source_path,
      m.slug as material_slug, m.publication_state as material_state, m.content_version as material_version,
      m.source_id as material_source_id, m.source_revision as material_source_revision
    from materials.practice_definitions p join materials.materials m on m.id = p.material_id
    where ${where}
    order by p.practice_id
  `),
  );
}

export async function loadPracticeSnapshot(
  prisma: MaterialsPrisma,
  practiceId: string,
) {
  return (
    await selectSnapshots(prisma, Prisma.sql`p.practice_id = ${practiceId}`)
  )[0];
}

export function listPracticeSnapshots(prisma: MaterialsPrisma, slug: string) {
  return selectSnapshots(
    prisma,
    Prisma.sql`m.slug = ${slug} and p.publication_state = 'published' and m.publication_state = 'published'`,
  );
}

/** Keep the selected ID set: new Practices are listed on the next read, not halfway through authorization. */
export async function loadPracticeSnapshots(
  prisma: MaterialsPrisma,
  ids: readonly string[],
) {
  const snapshots: PracticeSnapshot[] = [];
  const snapshotBatchSize = 100;
  for (let offset = 0; offset < ids.length; offset += snapshotBatchSize) {
    snapshots.push(
      ...(await selectSnapshots(
        prisma,
        Prisma.sql`p.practice_id in (${Prisma.join(ids.slice(offset, offset + snapshotBatchSize))})`,
      )),
    );
  }
  return snapshots;
}
