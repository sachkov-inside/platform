import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  MaterialReadingScope,
  type MaterialReadingSnapshot,
} from "@/entities/material";
import { withDeferredTaskStatuses } from "@/features/library-discovery";
import {
  courseGuide,
  taskOnlyCourse,
} from "@/storybook/course-reading.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  CourseRail,
  CourseReadingLayout,
  CourseTaskSubmissionStatuses,
} from "./course-reading.client";

const meta = {
  ...publicPageEnvironment("/materials/course-intro"),
  title: "Patterns/Product/Course status ownership",
};
export default meta;

const states = new Map<string, MaterialReadingSnapshot>();
const reading = {
  accountId: "reader",
  resolved: true,
  failed: false,
  states,
  register: () => () => undefined,
  refresh: () => Promise.resolve(),
};
const tasks = withDeferredTaskStatuses(taskOnlyCourse);
const submitted = [tasks.current.id];
const empty: readonly string[] = [];

function TaskLayouts() {
  const [compare, setCompare] = useState(false);
  const [source, setSource] = useState("absent");
  const href =
    source === "foreign" ? "/products/other/programme" : tasks.courseHref;
  return (
    <MaterialReadingScope value={reading}>
      <label>
        Источник первого курса
        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="absent">Нет данных</option>
          <option value="submitted">Сдано</option>
          <option value="pending">Не сдано</option>
          <option value="foreign">Другой курс</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={compare}
          onChange={(e) => setCompare(e.target.checked)}
        />
        Сравнить со вторым курсом
      </label>
      <section aria-label="Первый курс">
        <CourseReadingLayout context={tasks}>
          {source !== "absent" && (
            <CourseTaskSubmissionStatuses
              courseHref={href}
              submittedTaskIds={source === "pending" ? empty : submitted}
            />
          )}
        </CourseReadingLayout>
      </section>
      {compare && (
        <section aria-label="Второй курс">
          <CourseReadingLayout context={tasks}>
            <CourseTaskSubmissionStatuses
              courseHref={tasks.courseHref}
              submittedTaskIds={submitted}
            />
          </CourseReadingLayout>
        </section>
      )}
    </MaterialReadingScope>
  );
}
export const PrivateTaskStatusBelongsToItsLayout = {
  render: () => <TaskLayouts />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const source = canvas.getByRole("combobox", {
      name: "Источник первого курса",
    });
    const status = (name: string) =>
      canvas
        .getByRole("region", { name })
        .querySelector('a[aria-current="step"]')
        ?.getAttribute("data-progress");
    async function check(expected: string) {
      await waitFor(() =>
        expect([status("Первый курс"), status("Второй курс")]).toEqual([
          expected,
          "done",
        ]),
      );
    }
    const compare = canvas.getByRole("checkbox", {
      name: "Сравнить со вторым курсом",
    });
    await userEvent.click(compare);
    await check("unknown");
    for (const [value, expected] of [
      ["submitted", "done"],
      ["pending", "todo"],
      ["foreign", "unknown"],
      ["submitted", "done"],
      ["absent", "unknown"],
    ] as const) {
      await userEvent.selectOptions(source, value);
      await check(expected);
    }
    await userEvent.click(compare);
  },
};

function readingOwner() {
  const active = new Set<{ id: string }>();
  return {
    value: {
      ...reading,
      register(id: string) {
        const lease = { id };
        active.add(lease);
        return () => {
          active.delete(lease);
        };
      },
    },
    materials: () => [...active].map((item) => item.id).sort(),
  };
}

function materialsCourse(...groups: readonly string[][]) {
  const chapter = courseGuide.chapters[0],
    step = chapter?.steps.find((item) => item.materialId !== undefined);
  if (!chapter || !step) throw new Error("Expected a lesson in the course");
  return {
    ...courseGuide,
    chapters: groups.map((ids, group) => ({
      ...chapter,
      id: group === 0 ? chapter.id : "another-chapter",
      steps: ids.map((materialId, index) => ({
        ...step,
        id: `lesson-${group}-${index}`,
        materialId,
      })),
    })),
  };
}
const left = materialsCourse(["a", "a"], ["b"]),
  right = materialsCourse(["b"]),
  revised = materialsCourse(["a"]);

function Demand() {
  const [owners] = useState(() => [readingOwner(), readingOwner()] as const);
  const [provider, setProvider] = useState<0 | 1>(0);
  const [leftMounted, setLeft] = useState(true),
    [rightMounted, setRight] = useState(true),
    [updated, setUpdated] = useState(false);
  const [snapshot, setSnapshot] = useState("");
  return (
    <>
      <button type="button" onClick={() => setProvider(1)}>
        Сменить поставщика
      </button>
      <button type="button" onClick={() => setLeft(false)}>
        Закрыть первый список
      </button>
      <button type="button" onClick={() => setUpdated(true)}>
        Изменить материалы
      </button>
      <button type="button" onClick={() => setRight(false)}>
        Закрыть второй список
      </button>
      <button
        type="button"
        onClick={() =>
          setSnapshot(JSON.stringify(owners.map((owner) => owner.materials())))
        }
      >
        Прочитать подписки
      </button>
      <output aria-label="Подписки">{snapshot}</output>
      <MaterialReadingScope value={owners[provider].value}>
        {leftMounted && (
          <section aria-label="Первый список">
            <CourseRail variant="sheet" context={left} />
          </section>
        )}
        {rightMounted && (
          <section aria-label="Второй список">
            <CourseRail variant="sheet" context={updated ? revised : right} />
          </section>
        )}
      </MaterialReadingScope>
    </>
  );
}
export const ReadingDemandFollowsTheCurrentProvider = {
  render: () => <Demand />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const click = (name: string) =>
      userEvent.click(canvas.getByRole("button", { name }));
    async function check(first: string[], second: string[]) {
      await click("Прочитать подписки");
      await expect(canvas.getByLabelText("Подписки").textContent).toBe(
        JSON.stringify([first, second]),
      );
    }
    const chapterButton = (name: string) =>
      within(canvas.getByRole("region", { name })).getByRole("button", {
        expanded: false,
      });
    await check(["a", "b", "b"], []);
    const first = chapterButton("Первый список"),
      second = chapterButton("Второй список");
    await click("Сменить поставщика");
    await expect(chapterButton("Первый список")).toBe(first);
    await expect(chapterButton("Второй список")).toBe(second);
    await check([], ["a", "b", "b"]);
    await click("Закрыть первый список");
    await check([], ["b"]);
    await click("Изменить материалы");
    await check([], ["a"]);
    await click("Закрыть второй список");
    await check([], []);
  },
};
