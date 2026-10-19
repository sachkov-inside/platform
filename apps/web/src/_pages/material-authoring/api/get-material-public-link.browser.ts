import { z } from "zod";
import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

const responseSchema = z.object({ url: z.url().nullable() }).strict();

export async function getMaterialPublicUrl(
  materialId: string,
): Promise<string | null> {
  const response = await requestAuthenticatedRead(
    `/api/authoring/materials/${encodeURIComponent(materialId)}/link`,
  );
  if (response.kind !== "ready")
    throw new Error("Material link is unavailable");
  return responseSchema.parse(response.value).url;
}
