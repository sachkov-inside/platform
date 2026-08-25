import { createContentLibrary } from "../../../src/modules/content-library/index.js";
import { createMaterials } from "../../../src/modules/materials/index.js";

type TestMaterialsDependencies = Omit<
  Parameters<typeof createMaterials>[0],
  "contentLibrary"
>;

export function createTestMaterials(dependencies: TestMaterialsDependencies) {
  return createMaterials({
    ...dependencies,
    contentLibrary: createContentLibrary({ database: dependencies.database }),
  });
}
