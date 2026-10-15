import { connection } from "next/server";
import { downloadInlineArtifact } from "@/features/product-artifacts.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly productId: string;
      readonly sourceId: string;
    }>;
  },
): Promise<Response> {
  await connection();
  return downloadInlineArtifact(request, await context.params);
}
