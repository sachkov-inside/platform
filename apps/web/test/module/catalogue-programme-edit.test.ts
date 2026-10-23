import { describe, expect, it } from "vitest";
import { editCatalogueProgramme } from "@/features/series-order/model/catalogue-programme-edit";

const placement = (id: string, materialId: string) => ({
  id,
  materialId,
  chapterId: null,
  stepGroup: null,
});
const entry = (materialId: string) => ({
  materialId,
  chapterId: null,
  stepGroup: null,
});

describe("catalogue programme edits", () => {
  it("reorders existing primary slots, retains repeated identities and does not enroll catalogue extras", () => {
    const current = [
      placement("a1", "a"),
      placement("b1", "b"),
      placement("a2", "a"),
    ];
    expect(
      editCatalogueProgramme(
        current,
        [entry("b"), entry("extra"), entry("a")],
        [],
      ),
    ).toEqual([current[1], current[0], current[2]]);
    expect(editCatalogueProgramme([], [entry("extra")], [])).toEqual([]);
  });

  it("removes only withdrawn catalogue occurrences and retains IDs when flattening chapters", () => {
    const current = [
      { ...placement("a1", "a"), chapterId: "chapter" },
      placement("b1", "b"),
      { ...placement("a2", "a"), chapterId: "chapter" },
    ];
    expect(editCatalogueProgramme(current, [entry("a")], [])).toEqual([
      placement("a1", "a"),
      placement("a2", "a"),
    ]);
  });
});
