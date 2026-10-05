/**
 * PROTOTYPE for #947 — throwaway, lives only on branch `prototype/947-task-page`.
 *
 * Three task pages (A — «Документ», B — «Бриф и панель сдачи», C — «Вкладки») on the real public
 * shell, and two programme chapters (1 — group of tasks after the video, 2 — tasks in the author's
 * order). «Все варианты» switches A/B/C with ← → or the bar at the bottom.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { publicPageEnvironment } from "@/workshop/story-environment";

import {
  authorOrder,
  groupedOrder,
  lockedChapter,
  submissions,
  task,
} from "./guide-task-prototype.fixtures";
import {
  DocumentVariant,
  LockedTask,
  PanelVariant,
  ProgrammeAuthorOrder,
  ProgrammeGrouped,
  PrototypeSwitcher,
  TabsVariant,
  type Acceptance,
} from "./guide-task-prototype";

const taskPath = `/products/${task.guide.slug}/tasks/${task.code}`;
const programmePath = `/products/${task.guide.slug}/programme`;

type VariantKey = "A" | "B" | "C";
const variantNames: readonly (readonly [VariantKey, string])[] = [
  ["A", "Документ"],
  ["B", "Бриф и панель сдачи"],
  ["C", "Вкладки"],
];
const views = { A: DocumentVariant, B: PanelVariant, C: TabsVariant } as const;

interface TaskArgs {
  readonly variant: VariantKey;
  readonly history: "submitted" | "first-time";
  readonly acceptance: Acceptance;
  readonly opened?: "agent" | "form";
}

function TaskPage({ variant, history, acceptance, opened }: TaskArgs) {
  const View = views[variant];
  return (
    <View
      acceptance={acceptance}
      {...(opened === undefined ? {} : { opened })}
      submissions={history === "submitted" ? submissions : []}
      task={task}
    />
  );
}

function SwitchableTaskPage(args: TaskArgs) {
  const [variant, setVariant] = useState<VariantKey>(args.variant);
  return (
    <div data-workshop-story>
      <TaskPage {...args} key={variant} variant={variant} />
      <PrototypeSwitcher
        current={variant}
        onChange={setVariant}
        variants={variantNames}
      />
    </div>
  );
}

const meta = {
  title: "Prototype/Task page 947",
  ...publicPageEnvironment(taskPath, { account: "authenticated" }),
  args: { variant: "A", history: "submitted", acceptance: "open" },
  argTypes: {
    variant: { control: "inline-radio", options: ["A", "B", "C"] },
    history: { control: "inline-radio", options: ["submitted", "first-time"] },
    acceptance: { control: "inline-radio", options: ["open", "closed"] },
    opened: { control: "inline-radio", options: [undefined, "agent", "form"] },
  },
  render: (args) => (
    <div data-workshop-story>
      <TaskPage {...args} />
    </div>
  ),
} satisfies Meta<TaskArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Start here: ← → switch A/B/C; controls switch history and acceptance. */
export const AllVariants: Story = {
  name: "Все варианты (← →)",
  render: (args) => <SwitchableTaskPage {...args} />,
};

export const ADocument: Story = { name: "A · Документ", args: { variant: "A" } };
export const ADocumentForm: Story = {
  name: "A · Документ — запасная форма",
  args: { variant: "A", opened: "form" },
};
export const BPanel: Story = { name: "B · Бриф и панель", args: { variant: "B" } };
export const BPanelSheet: Story = {
  name: "B · Бриф и панель — «Сдать»",
  args: { variant: "B", opened: "agent" },
};
export const BPanelSheetForm: Story = {
  name: "B · Бриф и панель — форма",
  args: { variant: "B", opened: "form" },
};
export const CTabs: Story = { name: "C · Вкладки", args: { variant: "C" } };
export const CTabsSubmit: Story = {
  name: "C · Вкладки — «Сдать»",
  args: { variant: "C", opened: "agent" },
};
export const FirstTime: Story = {
  name: "Первый раз, сдач нет",
  args: { history: "first-time" },
  render: (args) => <SwitchableTaskPage {...args} />,
};
export const AcceptanceClosed: Story = {
  name: "Приём сдач выключен",
  args: { acceptance: "closed", opened: "form" },
  render: (args) => <SwitchableTaskPage {...args} />,
};

export const Locked: Story = {
  name: "Закрытое задание",
  render: () => (
    <div data-workshop-story>
      <LockedTask task={task} />
    </div>
  ),
};

type ProgrammeKey = "1" | "2";
const programmeNames: readonly (readonly [ProgrammeKey, string])[] = [
  ["1", "Группа после видео"],
  ["2", "В авторском порядке"],
];

function Programme({ layout }: { readonly layout: ProgrammeKey }) {
  return layout === "1" ? (
    <ProgrammeGrouped
      after={groupedOrder.after}
      before={groupedOrder.before}
      locked={lockedChapter}
      tasks={groupedOrder.tasks}
    />
  ) : (
    <ProgrammeAuthorOrder chapter={authorOrder} locked={lockedChapter} />
  );
}

function SwitchableProgramme({ layout }: { readonly layout: ProgrammeKey }) {
  const [current, setCurrent] = useState<ProgrammeKey>(layout);
  return (
    <div data-workshop-story>
      <Programme layout={current} />
      <PrototypeSwitcher
        current={current}
        onChange={setCurrent}
        variants={programmeNames}
      />
    </div>
  );
}

export const ProgrammeVariants: Story = {
  name: "Программа: задания в главе (← →)",
  ...publicPageEnvironment(programmePath, { account: "authenticated" }),
  render: () => <SwitchableProgramme layout="2" />,
};
export const ProgrammeOne: Story = {
  name: "Программа 1 · Группа после видео",
  ...publicPageEnvironment(programmePath, { account: "authenticated" }),
  render: () => (
    <div data-workshop-story>
      <Programme layout="1" />
    </div>
  ),
};
export const ProgrammeTwo: Story = {
  name: "Программа 2 · В авторском порядке",
  ...publicPageEnvironment(programmePath, { account: "authenticated" }),
  render: () => (
    <div data-workshop-story>
      <Programme layout="2" />
    </div>
  ),
};
