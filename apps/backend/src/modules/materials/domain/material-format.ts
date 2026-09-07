import { z } from "zod";

export const materialFormatSchema = z.enum(["video", "guide", "note"]);
export type MaterialFormat = z.infer<typeof materialFormatSchema>;

const names: Readonly<Record<MaterialFormat, string>> = {
  video: "Видео",
  guide: "Гайд",
  note: "Заметка",
};

export const materialFormats = Object.freeze(materialFormatSchema.options.map((id) =>
  Object.freeze({ id, slug: id, name: names[id] }),
));

export function materialFormatPresentation(value: unknown) {
  const id = materialFormatSchema.parse(value);
  return { id, slug: id, name: names[id] };
}
