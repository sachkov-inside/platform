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

export const KeepsUnpersistedChoiceAcrossRetention: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const descriptor = Object.getOwnPropertyDescriptor(
      Storage.prototype,
      "setItem",
    );
    if (descriptor === undefined)
      throw new Error("Missing native storage writer");
    const local = localStorage;
    const session = sessionStorage;
    const writeLocal = local.setItem.bind(local);
    const writeSession = session.setItem.bind(session);
    const collapse = canvas.getByRole("button", {
      name: "Свернуть меню уроков",
    });
    await expect(collapse).toBeVisible();
    try {
      // Named synthetic native quota fault for the course-menu key only, not a real privacy setting.
      Object.defineProperty(Storage.prototype, "setItem", {
        ...descriptor,
        value: function (this: Storage, key: string, value: string) {
          if (this === local) {
            if (key === courseMenuStorageKey)
              throw new DOMException(
                "Synthetic full storage",
                "QuotaExceededError",
              );
            writeLocal(key, value);
          } else if (this === session) {
            writeSession(key, value);
          } else {
            throw new TypeError("Unexpected native storage receiver");
          }
        },
      });
      await userEvent.click(collapse);
      const expand = canvas.getByRole("button", {
        name: "Развернуть меню уроков",
      });
      await expect(expand).toBeVisible();
      await expect(expand).toHaveFocus();
      await expect(localStorage.getItem(courseMenuStorageKey)).toBeNull();
      await expect(
        document.documentElement.getAttribute(courseMenuAttribute),
        "after rejected write before retention",
      ).toBe("collapsed");
      await userEvent.click(
        canvas.getByRole("button", { name: "Скрыть страницу курса" }),
      );
      await waitFor(() => expect(expand).not.toBeVisible());
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуть страницу курса" }),
      );
      await waitFor(() =>
        expect({
          phase: "after retained return",
          connected: expand.isConnected,
          choice: document.documentElement.getAttribute(courseMenuAttribute),
        }).toEqual({
          phase: "after retained return",
          connected: true,
          choice: "collapsed",
        }),
      );
      await waitFor(() => expect(expand).toBeVisible());
      await expect(
        canvas.getByRole("button", { name: "Развернуть меню уроков" }),
      ).toBe(expand);
    } finally {
      Object.defineProperty(Storage.prototype, "setItem", descriptor);
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуть страницу курса" }),
      );
      const expand = canvas.queryByRole("button", {
        name: "Развернуть меню уроков",
      });
      if (expand !== null) await userEvent.click(expand);
      localStorage.removeItem(courseMenuStorageKey);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: courseMenuStorageKey,
          storageArea: localStorage,
        }),
      );
      await waitFor(() =>
        expect(
          canvas.getByRole("button", { name: "Свернуть меню уроков" }),
        ).toBeVisible(),
      );
    }
  },
};
