import { expect, it } from "vitest";
import { productRevocationPreviewResponseSchema } from "@/entities/subscription/model/product-revocation";

it.each(["paid", "manual", "legacy", "course_activation", "unknown"])(
  "owner preview decodes factual %s origin without changing unified affected count",
  (source) => {
    const preview = {
      ok: true,
      value: {
        accountId: "00000000-0000-4000-8000-000000000001",
        productId: "00000000-0000-4000-8000-000000000002",
        revision: 1,
        affectedCount: 1,
        affected: [{ source, capabilities: ["materials"], validUntil: null }],
      },
    };
    expect(
      productRevocationPreviewResponseSchema.safeParse(preview).success,
    ).toBe(true);
    expect(
      productRevocationPreviewResponseSchema.safeParse({
        ...preview,
        value: {
          ...preview.value,
          affected: [{ ...preview.value.affected[0], source: "invented" }],
        },
      }).success,
    ).toBe(false);
  },
);
