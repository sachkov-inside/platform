import type { StoredObject } from "./object-storage.js";

/** Only immutable public image bytes live here; callers still authorize every delivery. */
export function createPublicImageCache({
  maxBytes = 16 * 1024 * 1024,
  maxEntries = 128,
  ttlMilliseconds = 60_000,
  now = Date.now,
} = {}) {
  const entries = new Map<
    string,
    { object: StoredObject; expiresAt: number }
  >();
  const pending = new Map<string, Promise<StoredObject | null>>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry !== undefined) bytes -= entry.object.body.byteLength;
    entries.delete(key);
  };
  return {
    invalidate(key: string) {
      remove(key);
      // A read started before deletion must not repopulate the cache afterward.
      pending.delete(key);
    },
    async read(key: string, load: () => Promise<StoredObject | null>) {
      const cached = entries.get(key);
      if (cached !== undefined && cached.expiresAt > now()) {
        entries.delete(key);
        entries.set(key, cached);
        return copy(cached.object);
      }
      remove(key);
      const existing = pending.get(key);
      if (existing !== undefined) return copy(await existing);
      // Bound the deduplication table too; untracked reads never populate the cache.
      if (pending.size >= maxEntries) return load();
      const request = load();
      pending.set(key, request);
      try {
        const object = await request;
        if (
          pending.get(key) === request &&
          object?.contentType === "image/webp" &&
          object.body.byteLength <= maxBytes
        ) {
          remove(key);
          // Expired entries should not evict a recently used live image.
          for (const [entryKey, entry] of entries)
            if (entry.expiresAt <= now()) remove(entryKey);
          while (
            entries.size >= maxEntries ||
            bytes + object.body.byteLength > maxBytes
          ) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            remove(oldest);
          }
          entries.set(key, {
            object: copy(object),
            expiresAt: now() + ttlMilliseconds,
          });
          bytes += object.body.byteLength;
        }
        return object;
      } finally {
        if (pending.get(key) === request) pending.delete(key);
      }
    },
  };
}

function copy(object: StoredObject): StoredObject;
function copy(object: StoredObject | null): StoredObject | null;
function copy(object: StoredObject | null): StoredObject | null {
  return object === null ? null : { ...object, body: object.body.slice() };
}
