import { unstable_cache } from "next/cache";

/** Прежний общий кеш: у него нет правила гостевого чтения. */
export const readLegacyCatalog = unstable_cache((slug: string) => Promise.resolve(slug));
