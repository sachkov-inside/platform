import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";

const maximumSlugLength = 120;
const slugAllocationLock = "materials:slug-allocation";
const advisoryLockRowsSchema = z.array(z.object({ lock: z.string() }).strict()).length(1);
const cyrillicTransliteration: Readonly<Record<string, string>> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function materialSlugBase(title: string): string {
  const transliterated = [...title.toLowerCase()]
    .map((character) => cyrillicTransliteration[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-+/gu, "-");
  return (transliterated || "material")
    .slice(0, maximumSlugLength)
    .replace(/-+$/u, "");
}

export async function allocateMaterialSlug(
  transaction: MaterialsPrismaTransaction,
  title: string,
): Promise<string> {
  const base = materialSlugBase(title);
  advisoryLockRowsSchema.parse(
    await transaction.$queryRaw(
      Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${slugAllocationLock}, 0::bigint))::text as lock`,
    ),
  );
  for (let suffix = 1; ; suffix += 1) {
    const suffixText = suffix === 1 ? "" : `-${String(suffix)}`;
    const candidate = `${base
      .slice(0, maximumSlugLength - suffixText.length)
      .replace(/-+$/u, "")}${suffixText}`;
    const existing = await transaction.material.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (existing === null) return candidate;
  }
}
