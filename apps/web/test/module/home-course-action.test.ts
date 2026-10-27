import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("@/widgets/product-reader-state/index.server", () => ({
  readProductReaderState: fakes.state,
}));
import { readHomeCourseAction } from "@/_pages/home/api/home-course-action.server";

const productId = "00000000-0000-4000-8000-000000000814";
const slug = "ai-engineering";
const learning = (materialSlug: string | null) => ({
  kind: "learning",
  continuation: {
    kind: "ready",
    continuation: materialSlug === null ? null : { materialSlug },
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  fakes.state.mockResolvedValue(learning(null));
});
it("opens the programme before the participant visits a lesson", async () => {
  expect(await readHomeCourseAction(productId, slug)).toEqual({
    kind: "programme",
    href: "/products/ai-engineering/programme",
    label: "Открыть программу",
  });
});
it("continues the participant's learning from the common reader state", async () => {
  fakes.state.mockResolvedValue(learning("course-intro"));
  expect(await readHomeCourseAction(productId, slug)).toMatchObject({
    label: "Продолжить обучение",
  });
  expect(fakes.state).toHaveBeenCalledWith(productId, slug);
});
it("keeps public course entry for guest, closed, unknown and unavailable reader states", async () => {
  for (const kind of ["sale", "waitlist", "checking", "unavailable"]) {
    fakes.state.mockResolvedValue({ kind });
    expect(await readHomeCourseAction(productId, slug)).toBeNull();
  }
});
it("opens the programme when personal learning continuation is unavailable", async () => {
  fakes.state.mockResolvedValue({
    kind: "learning",
    continuation: { kind: "unavailable" },
  });
  expect(await readHomeCourseAction(productId, slug)).toMatchObject({
    label: "Открыть программу",
  });
});
