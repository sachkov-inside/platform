import type { Meta, StoryObj } from "@storybook/react-vite";
import { currentLegalEdition } from "@inside/legal";
import { expect, waitFor, within } from "storybook/test";

import {
  CourseNavigationBar,
  CourseNavigationItem,
} from "@/features/library-discovery";
import { storageNoticeKey } from "@/features/storage-notice";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { publicPageEnvironment } from "@/storybook/story-environment";

const meta = {
  ...publicPageEnvironment("/products/ai-engineering"),
  title: "Pages/Learning/Course notice clearance",
  component: CourseNavigationBar,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  args: {
    label: "Проверяемая навигация",
    reserveSpace: true,
    children: (
      <>
        <CourseNavigationItem
          label="Программа"
          href={productProgrammeHref("ai-engineering")}
          current
        />
        <CourseNavigationItem
          label="Материалы"
          href={productProgrammeHref("ai-engineering")}
        />
      </>
    ),
  },
  render: (args) => (
    <section aria-label="Место под нижнюю навигацию">
      <CourseNavigationBar {...args} />
    </section>
  ),
} satisfies Meta<typeof CourseNavigationBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StorageNoticeClearance: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = canvas.getByRole("region", {
      name: "Место под нижнюю навигацию",
    });
    const nav = canvas.getByRole("navigation", {
      name: "Проверяемая навигация",
    });
    const clearance = () =>
      Math.round(
        region.getBoundingClientRect().height -
          nav.getBoundingClientRect().height -
          Number.parseFloat(getComputedStyle(nav).bottom),
      );
    const geometry = () => ({
      navHeight: nav.getBoundingClientRect().height,
      navBottom: getComputedStyle(nav).bottom,
      flowHeight: region.getBoundingClientRect().height,
      noticeSpace: document.documentElement.style.getPropertyValue(
        "--storage-notice-space",
      ),
      navConnected: nav.isConnected,
      regionConnected: region.isConnected,
      fonts: document.fonts.status,
    });
    await expect(nav).toBeVisible();
    await waitFor(() => expect(clearance()).toBe(12));
    const initial = geometry();
    try {
      // Synthetic storage delivery reaches the real shell subscriber; actual cross-document delivery is a separate Next check.
      localStorage.removeItem(storageNoticeKey);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: storageNoticeKey,
          storageArea: localStorage,
        }),
      );
      await expect(
        await canvas.findByRole("region", { name: "Хранение в браузере" }),
      ).toBeVisible();
      await waitFor(() =>
        expect(
          Number.parseFloat(
            document.documentElement.style.getPropertyValue(
              "--storage-notice-space",
            ),
          ),
        ).toBeGreaterThan(0),
      );
      await waitFor(() =>
        expect(clearance(), JSON.stringify({ initial, now: geometry() })).toBe(
          12,
        ),
      );
    } finally {
      localStorage.setItem(
        storageNoticeKey,
        String(currentLegalEdition("cookies").version),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: storageNoticeKey,
          storageArea: localStorage,
        }),
      );
      await waitFor(() =>
        expect(
          canvas.queryByRole("region", { name: "Хранение в браузере" }),
        ).not.toBeInTheDocument(),
      );
    }
  },
};
