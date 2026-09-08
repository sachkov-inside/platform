import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    order: z.object({
      archived: z.boolean(),
      seriesId: z.uuid(),
      name: z.string(),
      orderVersion: z.string(),
      items: z.array(
        z.object({
          materialId: z.uuid(),
          title: z.string(),
          publicationState: z.enum(["draft", "published", "unpublished"]),
          stepGroup: z.string().nullable().default(null),
        }),
      ),
    }),
  }),
  z.object({ kind: z.enum(["error", "not_found", "unauthorized"]) }),
]);
export const seriesOrderQueryOptions = (seriesId: string) =>
  queryOptions({
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryKey: ["series-order", seriesId],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/authoring/series/${encodeURIComponent(seriesId)}/order`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error("series-order-read");
      return schema.parse(await response.json());
    },
  });
