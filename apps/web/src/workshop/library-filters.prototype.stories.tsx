"use client";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { Button } from "@/shared/ui/button";
import { LibraryFilters } from "@/workshop/library-filters.prototype";

const formatOptions = ["Видео", "Гайд"] as const;
const topicOptions = ["Product engineering", "AI-first engineering", "Карьера"] as const;
const seriesOptions = [
  { label: "Создание Platform Inside", value: "series-platform-inside" },
] as const;

function InlineFiltersFixture() {
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<readonly string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);

  return (
    <div className="w-full max-w-3xl rounded-xl bg-muted/55 p-4">
      <LibraryFilters
        density="compact"
        formatOptions={formatOptions}
        selectedFormats={selectedFormats}
        selectedSeriesIds={selectedSeriesIds}
        selectedTopics={selectedTopics}
        seriesOptions={seriesOptions}
        setSelectedFormats={setSelectedFormats}
        setSelectedSeriesIds={setSelectedSeriesIds}
        setSelectedTopics={setSelectedTopics}
        topicOptions={topicOptions}
      />
    </div>
  );
}

function InlineDisclosureFixture() {
  const [expanded, setExpanded] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<readonly string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);
  const activeFilterCount =
    selectedFormats.length + selectedSeriesIds.length + selectedTopics.length;

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
            selectedSeriesIds={selectedSeriesIds}
            selectedTopics={selectedTopics}
            seriesOptions={seriesOptions}
            setSelectedFormats={setSelectedFormats}
            setSelectedSeriesIds={setSelectedSeriesIds}
            setSelectedTopics={setSelectedTopics}
            topicOptions={topicOptions}
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
    selectedSeriesIds: [],
    selectedTopics: [],
    seriesOptions,
    setSelectedFormats: () => undefined,
    setSelectedSeriesIds: () => undefined,
    setSelectedTopics: () => undefined,
    topicOptions,
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
          "Compact canonical Library facets. Topic, Format and Series use multi-select checkboxes directly in page flow; Tags remain searchable links on materials.",
      },
    },
  },
  title: "Patterns/Filtering/Library filters",
} satisfies Meta<typeof LibraryFilters>;

export default meta;

type Story = StoryObj<typeof meta>;

export const InlinePanel: Story = {
  name: "Inline filters",
  render: () => <InlineFiltersFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const filters = canvas.getByRole("region", { name: "Фильтры библиотеки" });

    await expect(filters.querySelectorAll('label > span[aria-hidden="true"]')).toHaveLength(0);

    await userEvent.click(canvas.getByRole("checkbox", { name: "Видео" }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Product engineering" }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Создание Platform Inside" }));
    await expect(canvas.getByRole("checkbox", { name: "Видео" })).toBeChecked();
    await expect(canvas.getByRole("checkbox", { name: "Product engineering" })).toBeChecked();
    await expect(canvas.getByRole("checkbox", { name: "Создание Platform Inside" })).toBeChecked();
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
