import "server-only";
import { z } from "zod";
import { materialTaxonomyLabel, publishedMaterialProjectionSchema } from "@/entities/material.model";
import { requestContinueMaterials } from "@/shared/api/backend/index.server";
import type { PersonalHomeView } from "../model/personal-home-view";
import { personalHomeResultSchema } from "../model/personal-home-contract";
const projection = z.array(z.object({ material: publishedMaterialProjectionSchema, lastOpenedAt: z.iso.datetime(), resume: z.unknown() }).strict()).max(6);
export async function getPersonalHome(accessToken: string): Promise<PersonalHomeView> {
  try {
    const response = await requestContinueMaterials(accessToken);
    if (!response.ok) return { kind: response.response.status === 401 ? "hidden" : "unavailable" };
    const parsed = projection.safeParse(response.body);
    if (!parsed.success || parsed.data.some((item) => item.material.availability !== "available")) return { kind: "unavailable" };
    const result = personalHomeResultSchema.safeParse({ kind: "ready", items: parsed.data.map(({ material, resume }) => ({ id: material.materialId, slug: material.slug, title: material.title, format: materialTaxonomyLabel(material.format.name), resume })) });
    return result.success ? result.data : { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
}
