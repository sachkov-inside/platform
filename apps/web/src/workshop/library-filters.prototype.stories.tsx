"use client";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { Button } from "@/shared/ui/button";
import {
  LibraryFilters,
  TagPicker,
} from "@/workshop/library-filters.prototype";

const formatOptions = ["Видео", "Гайд"] as const;
const tagOptions = [
  "platform build",
  "developer pipeline",
  "harness",
  "agent skills",
  "engineering workflow",
  "job search",
  "resume",
] as const;

function SearchableTagPickerFixture() {
  const [selected, setSelected] = useState<readonly string[]>(["harness"]);

  return (
    <div className="w-full max-w-lg rounded-xl bg-muted/55 p-4">
      <TagPicker options={tagOptions} selected={selected} setSelected={setSelected} />
    </div>
  );
}

function InlineFiltersFixture() {
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);

  return (
    <div className="w-full max-w-3xl rounded-xl bg-muted/55 p-4">
      <LibraryFilters
        density="compact"
        formatOptions={formatOptions}
        selectedFormats={selectedFormats}
        selectedTags={selectedTags}
        setSelectedFormats={setSelectedFormats}
        setSelectedTags={setSelectedTags}
        tagOptions={tagOptions}
      />
    </div>
  );
}

function InlineDisclosureFixture() {
  const [expanded, setExpanded] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);
  const activeFilterCount = selectedFormats.length + selectedTags.length;

  return (
    <div className="w-full max-w-3xl">
      <Button
        aria-controls="storybook-inline-filters"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((current) => !current);
        }}
        variant="outline"
      >
        <SlidersHorizontal aria-hidden="true" />
        {activeFilterCount > 0 ? `Фильтры · ${String(activeFilterCount)}` : "Фильтры"}
      </Button>
      {expanded ? (
        <div className="mt-2 rounded-xl bg-muted/55 p-4" id="storybook-inline-filters">
          <LibraryFilters
            density="compact"
            formatOptions={formatOptions}
            selectedFormats={selectedFormats}
            selectedTags={selectedTags}
            setSelectedFormats={setSelectedFormats}
            setSelectedTags={setSelectedTags}
            tagOptions={tagOptions}
          />
        </div>
      ) : null}
    </div>
  );
}

const meta = {
  args: {
    formatOptions,
    selectedFormats: [],
    selectedTags: [],
    setSelectedFormats: () => undefined,
    setSelectedTags: () => undefined,
    tagOptions,
  },
  component: LibraryFilters,
  decorators: [
    (Story) => (
      <div className="min-h-svh bg-card p-6 sm:p-10">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Compact library filtering pattern. Tag search limits visible suggestions, keeps selected values removable, and can live directly in page flow without a modal surface.",
      },
    },
  },
  title: "Patterns/Filtering/Library filters",
} satisfies Meta<typeof LibraryFilters>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SearchableTags: Story = {
  name: "Searchable tag picker",
  render: () => <SearchableTagPickerFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const searchInput = canvas.getByRole("searchbox", { name: "Теги" });

    await userEvent.type(searchInput, "agent");
    await userEvent.click(canvas.getByRole("checkbox", { name: "agent skills" }));
    await expect(canvas.getByRole("button", { name: "Убрать тег: agent skills" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Убрать тег: harness" }));
    await expect(canvas.queryByRole("button", { name: "Убрать тег: harness" })).not.toBeInTheDocument();
  },
};

export const InlinePanel: Story = {
  name: "Inline filters",
  render: () => <InlineFiltersFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("checkbox", { name: "Видео" }));
    await userEvent.type(canvas.getByRole("searchbox", { name: "Теги" }), "pipeline");
    await userEvent.click(canvas.getByRole("checkbox", { name: "developer pipeline" }));
    await expect(canvas.getByRole("button", { name: "Убрать тег: developer pipeline" })).toBeInTheDocument();
  },
};

export const InlineDisclosure: Story = {
  name: "Inline disclosure",
  render: () => <InlineDisclosureFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Фильтры" });

    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("region", { name: "Фильтры библиотеки" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("checkbox", { name: "Гайд" }));
    await expect(canvas.getByRole("button", { name: "Фильтры · 1" })).toBeInTheDocument();
  },
};
