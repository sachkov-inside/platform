/** Frozen Telegram album input. The adapter validates these records before provider I/O. */
export type NativeAlbumMedia = Readonly<Record<string, unknown>> & {
  readonly type: "photo" | "video" | "audio" | "document" | "live_photo";
  readonly media: string;
};
export function nativeAlbumMedia(
  message: Record<string, unknown>,
): NativeAlbumMedia | undefined {
  const kinds = ["photo", "video", "audio", "document", "live_photo"] as const;
  const present = kinds.filter(
    (kind) =>
      message[kind] !== undefined &&
      !(kind === "photo" && message["live_photo"] !== undefined),
  );
  const type = present[0];
  if (present.length !== 1 || type === undefined) return;
  const value = message[type];
  const file: unknown =
    type === "photo" && Array.isArray(value) ? value.at(-1) : value;
  if (!record(file) || !fileId(file["file_id"])) return;
  const caption = message["caption"] ?? "";
  const entities: unknown = message["caption_entities"] ?? [];
  if (
    typeof caption !== "string" ||
    caption.length > 1024 ||
    !Array.isArray(entities) ||
    entities.length > 1000
  )
    return;
  const entityValues: readonly unknown[] = entities;
  if (
    !entityValues.every(
      (entity) =>
        record(entity) &&
        typeof entity["type"] === "string" &&
        typeof entity["offset"] === "number" &&
        Number.isSafeInteger(entity["offset"]) &&
        entity["offset"] >= 0 &&
        typeof entity["length"] === "number" &&
        Number.isSafeInteger(entity["length"]) &&
        entity["length"] > 0 &&
        entity["offset"] + entity["length"] <= caption.length,
    )
  )
    return;
  const media: Record<string, unknown> = {
    type,
    media: file["file_id"],
    caption,
    caption_entities: structuredClone(entityValues),
  };
  if (type === "photo" || type === "video" || type === "live_photo") {
    for (const [source, target] of [
      ["has_media_spoiler", "has_spoiler"],
      ["show_caption_above_media", "show_caption_above_media"],
    ] as const) {
      if (message[source] !== undefined && typeof message[source] !== "boolean")
        return;
      if (message[source] !== undefined) media[target] = message[source];
    }
  }
  if (type === "audio" || type === "video") {
    for (const key of type === "video"
      ? ["width", "height", "duration", "start_timestamp"]
      : ["duration"]) {
      const field = file[key];
      if (
        field !== undefined &&
        (typeof field !== "number" || !Number.isFinite(field) || field < 0)
      )
        return;
      if (field !== undefined) media[key] = field;
    }
  }
  if (type === "audio")
    for (const key of ["performer", "title"]) {
      if (file[key] !== undefined && typeof file[key] !== "string") return;
      if (file[key] !== undefined) media[key] = file[key];
    }
  if (type === "video" || type === "live_photo") {
    const photos =
      type === "video" ? file["cover"] : (file["photo"] ?? message["photo"]);
    const photo: unknown = Array.isArray(photos) ? photos.at(-1) : undefined;
    if (type === "live_photo" || photos !== undefined) {
      if (!record(photo) || !fileId(photo["file_id"])) return;
      media[type === "video" ? "cover" : "photo"] = photo["file_id"];
    }
  }
  return { ...media, type, media: file["file_id"] };
}
export function fileId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,1024}$/u.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
