import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { courseGuide } from "@/storybook/course-reading.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import {
  courseMenuAttribute,
  courseMenuStorageKey,
} from "../model/course-menu";
import { CourseReadingLayout } from "./course-reading.client";

const environment = publicPageEnvironment("/materials/course-intro");

function RetainedMenu() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
        }}
      >
        Скрыть страницу курса
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Вернуть страницу курса
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Удалить страницу курса
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <CourseReadingLayout context={courseGuide}>
            <p>Содержимое сохранённого урока</p>
          </CourseReadingLayout>
        ) : null}
      </Activity>
    </>
  );
}

const meta = {
  ...environment,
  title: "Patterns/Product/Course menu lifetime",
  component: RetainedMenu,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  beforeEach: () => {
    const cleanup = environment.beforeEach();
    localStorage.removeItem(courseMenuStorageKey);
    document.documentElement.removeAttribute(courseMenuAttribute);
    return () => {
      localStorage.removeItem(courseMenuStorageKey);
      document.documentElement.removeAttribute(courseMenuAttribute);
      cleanup?.();
    };
  },
} satisfies Meta<typeof RetainedMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const KeepsChoiceAcrossRetention: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const collapse = canvas.getByRole("button", {
      name: "Свернуть меню уроков",
    });
    await expect(collapse).toBeVisible();
    await userEvent.click(collapse);
    const expand = canvas.getByRole("button", {
      name: "Развернуть меню уроков",
    });
    await expect(expand).toBeVisible();
    await expect(expand).toHaveFocus();
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть страницу курса" }),
    );
    await waitFor(() => expect(expand).not.toBeVisible());
    await expect(expand.isConnected).toBe(true);
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть страницу курса" }),
    );
    await waitFor(() => expect(expand).toBeVisible());
    await expect(
      canvas.getByRole("button", { name: "Развернуть меню уроков" }),
    ).toBe(expand);
    await userEvent.click(expand);
    await expect(collapse).toBeVisible();
    await expect(collapse).toHaveFocus();
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить страницу курса" }),
    );
    await waitFor(() => expect(expand.isConnected).toBe(false));
  },
};
