import { expect, test } from "vitest";
import { projectReferenceMaterials } from "@/features/library-discovery/model/project-reference-materials";

test("reference navigation uses existing imported identities and preserves their actual URLs", () => {
  const brief = { slug: "inside-content-aie-product-brief" };
  const project = { slug: "inside-content-aie-project" };
  expect(
    projectReferenceMaterials([
      brief,
      { slug: "inside-content-aie-project-setup" },
      project,
    ]),
  ).toEqual([project, brief]);
  expect(projectReferenceMaterials([{ slug: "aie-project-setup" }])).toEqual(
    [],
  );
});
