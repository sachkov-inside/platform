import {
  currentLegalEdition,
  findLegalEdition,
  parseLegalText,
  supersededLegalEditions,
  type LegalDocumentKey,
} from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import {
  legalDocumentPath,
  legalEditionPath,
} from "@/shared/routing/public-page-path";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { LegalDocumentPage } from "./legal-document-page";

/**
 * Состав страницы из настоящего комплекта `@inside/legal`, как его собирает `legalDocumentView`:
 * запрошенная редакция, действующая и прежние. Адрес story — адрес маршрута этой редакции.
 */
function legalRoute(
  key: LegalDocumentKey,
  version?: number,
): Pick<Story, "args" | "beforeEach" | "decorators" | "parameters"> {
  const current = currentLegalEdition(key);
  const edition =
    version === undefined ? current : findLegalEdition(key, version);
  if (edition === undefined)
    throw new Error(`В комплекте нет редакции ${key} v${String(version)}`);
  const { beforeEach, decorators, parameters } = publicPageEnvironment(
    version === undefined
      ? legalDocumentPath(key)
      : legalEditionPath(key, version),
  );
  return {
    args: {
      blocks: parseLegalText(edition.text),
      current,
      edition,
      superseded: supersededLegalEditions(key),
    },
    beforeEach,
    decorators,
    parameters,
  };
}

const terms = currentLegalEdition("terms");

const meta = {
  component: LegalDocumentPage,
  title: "Pages/Legal/Документ",
  args: {
    blocks: parseLegalText(terms.text),
    current: terms,
    edition: terms,
    superseded: [],
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LegalDocumentPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Действующая редакция условий использования: прежних редакций у документа пока нет. */
export const Current: Story = {
  ...legalRoute("terms"),
  globals: { viewport: { value: "desktop1440", isRotated: false } },
};

export const Mobile: Story = {
  ...Current,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/**
 * Оферта разовой покупки: подразделы третьего уровня, списки и прежние редакции, адреса которых
 * остаются рабочими.
 */
export const PurchaseOffer: Story = {
  ...legalRoute("purchase"),
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", {
        level: 3,
        name: "Что входит в сопровождение",
      }),
    ).toBeVisible();
    await expect(canvas.getAllByRole("list").length).toBeGreaterThan(0);
    // Маркер пункта рисует список, поэтому в тексте его нет.
    await expect(canvas.queryByText(/^- /u)).not.toBeInTheDocument();
    for (const earlier of supersededLegalEditions("purchase"))
      await expect(
        canvas.getByRole("link", {
          name: new RegExp(`^Редакция ${String(earlier.version)} ·`, "u"),
        }),
      ).toHaveAttribute("href", legalEditionPath("purchase", earlier.version));
  },
};

export const PurchaseOfferMobile: Story = {
  ...PurchaseOffer,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

const earlierPurchase = supersededLegalEditions("purchase")[0];
if (earlierPurchase === undefined)
  throw new Error("У оферты нет прежней редакции");

/** `/legal/purchase/v<N>`: прежняя редакция с отметкой и ссылкой на действующий текст. */
export const EarlierEdition: Story = {
  ...legalRoute("purchase", earlierPurchase.version),
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(
        new RegExp(`Это редакция ${String(earlierPurchase.version)}`, "u"),
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", {
        name: `редакция ${String(currentLegalEdition("purchase").version)}`,
      }),
    ).toHaveAttribute("href", legalDocumentPath("purchase"));
  },
};
