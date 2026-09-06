import { z } from "zod";

// A link is only a convenient object reference. Never fetch it or treat its host
// as proof of access; the provider still checks the template owner.
export const templateReferenceSchema = z.string().trim().min(1).max(2048).transform((value, context) => {
  if (z.guid().safeParse(value).success) return value;
  const parsed = z.url().safeParse(value);
  if (parsed.success) {
    const url = new URL(parsed.data);
    const parts = url.pathname.split("/");
    const id = z.guid().safeParse(parts[3]);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      parts.length === 4 && parts[1] === "communications" && parts[2] === "templates" && id.success) return id.data;
  }
  context.addIssue({ code: "custom", message: "Expected a template UUID or HTTPS /communications/templates/<uuid> reference" });
  return z.NEVER;
});
