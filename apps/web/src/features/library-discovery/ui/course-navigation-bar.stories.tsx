import { LayoutGrid, List } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { currentLegalEdition } from "@inside/legal";
import { Activity, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { storageNoticeKey } from "@/features/storage-notice";
import {
  CourseNavigationBar,
  CourseNavigationItem,
} from "./course-navigation-bar.client";

const meta = {
  ...publicPageEnvironment("/products/ai-engineering"),
  id: "features-library-course-navigation",
  title: "Components/Product/Course navigation",
  component: CourseNavigationBar,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  args: {
    label: "Навигация курса",
    children: (
      <>
        <CourseNavigationItem
          icon={List}
          label="Программа"
          href={productProgrammeHref("ai-engineering")}
          current
        />
        <CourseNavigationItem
          icon={LayoutGrid}
          label="Материалы"
          href={productProgrammeHref("ai-engineering")}
        />
      </>
    ),
  },
} satisfies Meta<typeof CourseNavigationBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Programme: Story = {};

function NavigationLifetime() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [reserve, setReserve] = useState(true);
  const [long, setLong] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLong((value) => !value);
        }}
      >
        Изменить подпись
      </button>
      <button
        type="button"
        onClick={() => {
          setReserve((value) => !value);
        }}
      >
        Переключить отступ
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible((value) => !value);
        }}
      >
        Скрыть или вернуть панель
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Удалить панель
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <section aria-label="Место под нижнюю навигацию">
          {mounted ? (
            <CourseNavigationBar
              label="Проверяемая навигация"
              reserveSpace={reserve}
            >
              <CourseNavigationItem
                label={
                  long
                    ? "Текущая глава и материалы для самостоятельной работы"
                    : "Программа"
                }
                href={productProgrammeHref("ai-engineering")}
                current
              />
              <CourseNavigationItem
                label="Материалы"
                href={productProgrammeHref("ai-engineering")}
              />
            </CourseNavigationBar>
          ) : null}
        </section>
      </Activity>
    </>
  );
}

export const MeasuredSpaceLifetime: Story = {
  render: () => <NavigationLifetime />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(window.innerWidth).toBe(390);
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
    await expect(nav).toBeVisible();
    await waitFor(() => expect(clearance()).toBe(12));
    const firstHeight = nav.getBoundingClientRect().height;
    await userEvent.click(
      canvas.getByRole("button", { name: "Изменить подпись" }),
    );
    await waitFor(() =>
      expect(nav.getBoundingClientRect().height).toBeGreaterThan(firstHeight),
    );
    await waitFor(() => expect(clearance()).toBe(12));
    await userEvent.click(
      canvas.getByRole("button", { name: "Переключить отступ" }),
    );
    await waitFor(() => expect(region.getBoundingClientRect().height).toBe(0));
    await expect(nav).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Изменить подпись" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Переключить отступ" }),
    );
    await waitFor(() => expect(clearance()).toBe(12));
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть или вернуть панель" }),
    );
    await waitFor(() => expect(nav).not.toBeVisible());
    await expect(nav.isConnected).toBe(true);
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть или вернуть панель" }),
    );
    await waitFor(() => expect(nav).toBeVisible());
    await expect(
      canvas.getByRole("navigation", { name: "Проверяемая навигация" }),
    ).toBe(nav);
    await waitFor(() => expect(clearance()).toBe(12));
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить панель" }),
    );
    await waitFor(() => expect(nav.isConnected).toBe(false));
    await expect(region.getBoundingClientRect().height).toBe(0);
  },
};

export const StorageNoticeClearance: Story = {
  render: () => <NavigationLifetime />,
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
