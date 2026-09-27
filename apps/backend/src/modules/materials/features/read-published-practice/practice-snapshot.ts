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

/** One statement observes the complete binding and lifecycle, including concurrent withdrawal. */
export async function loadPracticeSnapshot(
  prisma: MaterialsPrisma,
  practiceId: string,
) {
  const rows = z.array(snapshotSchema).parse(
    await prisma.$queryRaw(Prisma.sql`
    select p.practice_id, p.practice_version, p.definition_digest, p.definition, p.publication_state,
      p.material_id, p.bound_source_id, p.bound_source_revision, p.bound_content_version,
      p.source_repository, p.source_commit, p.source_path,
      m.slug as material_slug, m.publication_state as material_state, m.content_version as material_version,
      m.source_id as material_source_id, m.source_revision as material_source_revision
    from materials.practice_definitions p join materials.materials m on m.id = p.material_id
    where p.practice_id = ${practiceId}
  `),
  );
  return rows[0];
}

export async function listPracticeIds(prisma: MaterialsPrisma, slug: string) {
  return z.array(z.object({ practice_id: z.string() })).parse(
    await prisma.$queryRaw(Prisma.sql`
    select p.practice_id from materials.practice_definitions p
    join materials.materials m on m.id = p.material_id
    where m.slug = ${slug} and p.publication_state = 'published' and m.publication_state = 'published'
    order by p.practice_id
  `),
  );
}
