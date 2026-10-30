import type { Meta, StoryObj } from "@storybook/react-vite";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { useState, type ComponentProps } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { authoringPageEnvironment } from "@/storybook/story-environment";
import { withMutationFetch } from "@/storybook/mutation-mock";
import { Button } from "@/shared/ui/button";
import { ProductEditorPageFrame } from "./product-editor-page-frame";
import {
  type ProductOrderPresentation,
  type CreateProductOrderMaterialSearchQueryOptions,
  type ProductOrderMaterialSearchResult,
} from "@/features/product-order";
import { ProductOrderManager } from "@/features/product-order";

const productId = "95000000-0000-4000-8000-000000000010";
const firstId = "95000000-0000-4000-8000-000000000001";
const secondId = "95000000-0000-4000-8000-000000000002";
const extraId = "95000000-0000-4000-8000-000000000003";
const chapterId = "95000000-0000-4000-8000-000000000020";
const firstItem = {
  materialId: firstId,
  title: "Первый материал",
  publicationState: "published" as const,
};
const secondItem = {
  materialId: secondId,
  title: "Второй материал",
  publicationState: "published" as const,
};
const extraItem = {
  materialId: extraId,
  title: "Справочный материал",
  publicationState: "published" as const,
};
const firstPlacement = {
  id: "95000000-0000-4000-8000-000000000031",
  materialId: firstId,
  chapterId: null,
  stepGroup: null,
};
const secondPlacement = {
  id: "95000000-0000-4000-8000-000000000032",
  materialId: secondId,
  chapterId: null,
  stepGroup: null,
};
const repeatedPlacement = {
  id: "95000000-0000-4000-8000-000000000033",
  materialId: firstId,
  chapterId: null,
  stepGroup: "Повторение",
};
const save = fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    Response.json({ kind: "saved", orderVersion: "b".repeat(64) }),
  ),
);
const createMaterialSearchQueryOptions: CreateProductOrderMaterialSearchQueryOptions =
  ({ page, search }) =>
    queryOptions({
      queryKey: ["product-order", "material-search", search, page] as const,
      queryFn: () =>
        Promise.resolve<ProductOrderMaterialSearchResult>({
          kind: "ready",
          items: [],
          page: 1,
          totalPages: 1,
          totalItems: 0,
        }),
    });
const environment = authoringPageEnvironment(
  `/authoring/products/${productId}`,
  {
    frame: ProductEditorPageFrame,
  },
);
const meta = {
  ...environment,
  id: "features-product-order-catalogue-programme-affordances",
  title: "Patterns/Authoring/Catalogue programme",
  component: ProductOrderManager,
  decorators: [withMutationFetch(save), ...environment.decorators],
  args: {
    embedded: true,
    onBack: fn(),
    onRefresh: fn(),
    onSelectPlaylist: fn(),
    createMaterialSearchQueryOptions,
    presentation: {
      archived: false,
      chapters: [],
      programmePlacements: [],
      items: [firstItem, secondItem],
      name: "Состав продукта",
      options: [{ label: "Состав продукта", value: productId }],
      productId: productId,
      orderVersion: "a".repeat(64),
    },
  },
} satisfies Meta<typeof ProductOrderManager>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CatalogueOnly: Story = {
  args: {
    presentation: {
      ...meta.args.presentation,
      chapters: [{ id: chapterId, name: "Глава", summary: "" }],
    },
  },
  play: async ({ canvasElement }) => {
    save.mockClear();
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Опустить «Первый материал»" }),
    ).toBeDisabled();
    const handle = canvas.getByRole("button", {
      name: "Переместить «Первый материал»",
    });
    await expect(handle).toBeDisabled();
    await expect(handle).toHaveAttribute("draggable", "false");
    const disclosure = canvas.getAllByText("Последовательность шагов")[0];
    if (disclosure === undefined) throw Error("Missing sequence disclosure");
    await userEvent.click(disclosure);
    await expect(
      canvas.getAllByRole("textbox", {
        name: "Название последовательности",
      })[0],
    ).toBeDisabled();
    await expect(
      canvas.getAllByRole("combobox", { name: "Глава" })[0],
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Размещения в программе" }),
    ).toBeEnabled();
    await expect(save).not.toHaveBeenCalled();
  },
};

const mixed: ProductOrderPresentation = {
  ...meta.args.presentation,
  programmePlacements: [firstPlacement, secondPlacement, repeatedPlacement],
  items: [firstItem, secondItem, extraItem],
};

/** The reload response is the worked public-PostgreSQL result from the programme diagnosis. */
function ReloadableProgramme(
  props: ComponentProps<typeof ProductOrderManager>,
) {
  const [reloaded, setReloaded] = useState(false);
  const presentation = reloaded
    ? {
        ...mixed,
        orderVersion: "b".repeat(64),
        items: [secondItem, firstItem, extraItem],
        programmePlacements: [
          secondPlacement,
          firstPlacement,
          repeatedPlacement,
        ],
      }
    : mixed;
  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setReloaded(true);
        }}
      >
        Перечитать состав
      </Button>
      <ProductOrderManager
        {...props}
        key={reloaded ? "reloaded" : "initial"}
        presentation={presentation}
      />
    </>
  );
}
export const ProgrammeWithCatalogueExtra: Story = {
  args: { presentation: mixed },
  render: (args) => <ReloadableProgramme {...args} />,
  play: async ({ canvasElement }) => {
    save.mockClear();
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Опустить «Второй материал»" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Поднять «Справочный материал»" }),
    ).toBeDisabled();
    // A forged drop still cannot promote a catalogue-only Material into the programme.
    const source = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Переместить «Первый материал»"]',
    );
    const extra = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Переместить «Справочный материал»"]',
    );
    if (source === null || extra === null) throw Error("Missing drag handles");
    const sourceRow = source.closest("li"),
      extraRow = extra.closest("li");
    if (sourceRow === null || extraRow === null)
      throw Error("Missing Material rows");
    const lastPrimaryHandle = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Переместить «Второй материал»"]',
    );
    if (lastPrimaryHandle === null)
      throw Error("Missing primary keyboard handle");
    lastPrimaryHandle.focus();
    await userEvent.keyboard("{ArrowDown}");
    const transfer = new DataTransfer();
    source.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }),
    );
    await nextBrowserFrame();
    extraRow.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
    await nextBrowserFrame();
    source.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }),
    );
    extra.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }),
    );
    await nextBrowserFrame();
    sourceRow.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
    await nextBrowserFrame();
    extra.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }),
    );
    await expect(save).not.toHaveBeenCalled();
    // Explicit existing primary occurrences retain keyboard ordering and repeated-slot identities.
    const down = canvas.getByRole("button", {
      name: "Опустить «Первый материал»",
    });
    down.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const body = save.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string")
      throw Error("Missing public composition request");
    const request = z.record(z.string(), z.unknown()).parse(JSON.parse(body));
    await expect(request["orderedMaterialIds"]).toEqual([
      secondId,
      firstId,
      extraId,
    ]);
    await expect(request["programmePlacements"]).toEqual([
      secondPlacement,
      firstPlacement,
      repeatedPlacement,
    ]);
    await userEvent.click(
      canvas.getByRole("button", { name: "Перечитать состав" }),
    );
    const rows = canvas
      .getByRole("list", { name: "Материалы продукта" })
      .querySelectorAll("li > div > div > p");
    await expect(rows[0]).toHaveTextContent("Второй материал");
    await expect(
      canvas.getByRole("button", { name: "Опустить «Первый материал»" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Опустить «Второй материал»" }),
    ).toBeEnabled();
    await expect(save).toHaveBeenCalledOnce();
  },
};

export const Mobile: Story = {
  ...ProgrammeWithCatalogueExtra,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Let React commit each native drag event before delivering the next browser event. */
function nextBrowserFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}
