import type { SavedPost } from "./broadcasts";

// Persist before the external write. Keep an uncertain request across reloads;
// only a confirmed acknowledgement allows another intentional sample.
export function sampleOperation(
  post: Pick<SavedPost, "templateId" | "revision">,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const key = `inside:communications:sample:${post.templateId}:${String(post.revision)}`;
  const id = storage.getItem(key) ?? crypto.randomUUID();
  storage.setItem(key, id);
  return {
    id,
    confirm() {
      if (storage.getItem(key) === id) storage.removeItem(key);
    },
  };
}
